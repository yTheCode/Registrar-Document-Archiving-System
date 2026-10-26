# Phase 1B — window, dev-mode and installer analysis (CP1)

Analysis only. No application file was changed in this checkpoint.

| Item | Value |
| --- | --- |
| Branch | `security/p1b-electron-hardening` (from `origin/main`, commit `bfd6396`) |
| Date | 2026-10-27 |
| Electron | 28.3.3 (`node_modules/electron/package.json`) |
| electron-builder | 24.13.3 (`node_modules/electron-builder/package.json`) |
| Method | Read `electron/main.cjs`, `electron/ipc/files.ipc.cjs`, `electron/preload.js`, `package.json`, `vite.config.ts`, `index.html`; `git grep` for `NODE_ENV`, `localhost:5173`, `openDevTools`, `isPackaged`, `BrowserWindow`, `openExternal`, `window.open`, `<a`, `href="http`, `getUserMedia`, `audio:`, `Notification(`, `navigator.clipboard`, `getDisplayMedia`, `will-navigate`, `setWindowOpenHandler`, `setPermission*Handler`, `will-attach-webview`, `sandbox`; `npm ls @electron/fuses`. Line numbers are for `bfd6396`. |

---

## 1. Where the app decides dev versus production

Exactly one decision point exists, `electron/main.cjs:17`:

```js
const usesDevServer = process.env.NODE_ENV === 'development' || !app.isPackaged;
```

Everything dev-related hangs off that single boolean:

| Use | Line | Effect |
| --- | --- | --- |
| `createUrlPolicy({ …, devServerOrigin: usesDevServer ? DEV_SERVER_URL : null })` | 21-24 | Q6 sender guard allows the Vite origin only when this is true |
| `if (usesDevServer) mainWindow.loadURL(DEV_SERVER_URL)` | 56-57 | loads `http://localhost:5173` |
| `mainWindow.webContents.openDevTools()` | 58 | opens DevTools on every start |
| `else mainWindow.loadFile(INDEX_HTML_PATH)` | 60 | packaged path |

`DEV_SERVER_URL = 'http://localhost:5173'` (line 15), `INDEX_HTML_PATH = path.join(__dirname, '../dist/index.html')` (line 16).

**Finding (the bypass this phase must close).** Because the test is an `||`, a **packaged**
build launched with `NODE_ENV=development` sets `usesDevServer = true`: it calls
`loadURL('http://localhost:5173')` and `openDevTools()`. `process.env.NODE_ENV` is
attacker- and launcher-controlled, so the installed exe can be flipped into dev mode.
No npm script sets `NODE_ENV` today (`package.json:10-24`), so the env half of the test
only ever fires in a packaged run — it is the bypass, not dev support.

There is no second dev/production switch anywhere: `git grep NODE_ENV` matches only
`electron/main.cjs:17` outside docs, and `git grep isPackaged` matches only that same
line. `vite.config.ts` pins `server.port: 5173` and `base: './'`.

## 2. Window creation and webPreferences

### Main window — `electron/main.cjs:34-61`

```js
const mainWindow = new BrowserWindow({
  width: 1280, height: 800, minWidth: 1024, minHeight: 600,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'preload.js')
  },
  autoHideMenuBar: true,
  icon: path.join(__dirname, '../src/assets/adzu-seal.png')
});
```

| Setting | Main window | Print window (`files.ipc.cjs:222-227`) |
| --- | --- | --- |
| `nodeIntegration` | `false` | `false` |
| `contextIsolation` | `true` | `true` |
| `sandbox` | **not set** (Electron default since v20 is `true`; not pinned in code) | `true` |
| `preload` | `electron/preload.js` (46 methods) | `PRELOAD_PATH` — **the same bridge** |
| `devTools` | not set (default `true`) | not set (default `true`) |
| `show` | `true` | `false` |
| menu | none is built; `autoHideMenuBar: true` hides the **default** Electron menu | — |

**Menu finding.** `Menu.setApplicationMenu` is never called (`git grep` has no match), so
an installed build keeps Electron's default application menu (File/Edit/View/Window/Help),
which contains Reload, Force Reload and Toggle Developer Tools. `autoHideMenuBar: true`
only hides the bar visually; Alt reveals it. CP3's `Menu.setApplicationMenu(null)` is a
real change, not a no-op.

### Print window — `electron/ipc/files.ipc.cjs:218-228`

Created per print job, `show: false`, 850x1100, with `sandbox: true`,
`nodeIntegration: false`, `contextIsolation: true`, `preload: PRELOAD_PATH`. It is
destroyed in a `finally` block (lines 244-247) after `webContents.print`.

### Other `BrowserWindow` constructors

`git grep BrowserWindow` finds exactly three: the main window (`main.cjs:35`), the print
window (`files.ipc.cjs:218`) and the `getAllWindows().length === 0` "recreate on activate"
check (`main.cjs:90`, macOS convention). **No other second window exists.**

## 3. Permissions the renderer actually needs

`git grep` shows the only privileged web API in `src/` is the camera:

| Use | Location |
| --- | --- |
| `navigator.mediaDevices.enumerateDevices()` | `src/features/import-scanner/components/ImportScannerPage.tsx:365` |
| `navigator.mediaDevices.getUserMedia({ video: { …device, width, height } })` | `ImportScannerPage.tsx:382` |
| `navigator.mediaDevices.getUserMedia({ video: device })` fallback | `ImportScannerPage.tsx:387` |
| `getSupportedConstraints()` / `getCapabilities()` | `src/utils/cameraCapabilities.ts:28` and later |
| `devicechange` listener | `ImportScannerPage.tsx:553-558` |

- **No audio anywhere**: no `audio:` constraint, no `getUserMedia({ audio })`.
- **No** `Notification`, `navigator.clipboard`, `requestFullscreen`, `getDisplayMedia`,
  geolocation, MIDI, HID, serial or USB use in `src/`.
- `src/utils/permissions.ts` (`canPerformAction`) is an app-role helper for UI buttons,
  unrelated to Electron permissions.

So the only permission that must be granted is **`media` with video only**.

Electron 28 handler details (from `node_modules/electron/electron.d.ts`):

- `setPermissionRequestHandler((webContents, permission, callback, details) => …)`;
  `details.mediaTypes?: Array<'video' | 'audio'>` (line 17907).
- `setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => boolean)`;
  `details.mediaType?: 'video' | 'audio' | 'unknown'` (line 17883).

The two handlers therefore receive the same fact in different shapes (array vs single
string), which the pure decision function must normalise.

## 4. Second windows, pop-ups and external links

- No `window.open`, no `<a href>` and no `href="http` in `src/` or `index.html`
  (`git grep` returns nothing).
- No `setWindowOpenHandler` and no `will-navigate`/`will-attach-webview` handler exists
  today.
- The only "open something outside the app" path is `window.electronAPI.openFileExternal`
  (`src/components/DocumentViewerModal.tsx:343,409`), which reaches
  `file:openExternal` → `shell.openPath(resolvedPath)` on an **archive file**
  (`files.ipc.cjs:39-57`); `file:showInFolder` uses `shell.showItemInFolder`
  (`files.ipc.cjs:72`), and `file:print` falls back to `shell.openPath` for PDFs/office
  files (`files.ipc.cjs:191-196`).

**Consequence for CP5:** the app never opens an http/https link in the system browser, so
nothing needs to be preserved in the window-open handler — it can deny unconditionally.
`shell.openPath` on archive files is a main-process action, not a navigation, and is
unaffected by `will-navigate`.

## 5. How the print window gets its content, and whether it calls the bridge

`file:print` (`files.ipc.cjs:171-254`):

1. Resolves the archive path and rejects anything outside the archive (`:180-186`).
2. For non-image files it hands the file to the OS (`shell.openPath`, `:191-196`) and
   **never creates a window**.
3. For images it writes a generated HTML file to `app.getPath('temp')/adzu-print-<ts>.html`
   (`:200-216`) whose body is a single `<img src="${pathToFileURL(resolvedPath).href}">`
   — the image is loaded by URL, not embedded.
4. `printWindow.loadFile(htmlPath)` (`:231`), then `webContents.print({ silent: false,
   printBackground: true })` (`:233-243`), then `destroy()` + `fs.rmSync(htmlPath)`
   (`:244-247`).

**The generated page contains no `<script>` and calls no `window.electronAPI` method.**
The only consumer of `PRELOAD_PATH` in that window is the bridge itself, which nothing in
the page uses. Printing is driven entirely from the main process.

**CP4 is therefore safe as specified:** dropping `preload` cannot break printing, because
the page never invokes IPC and `webContents.print` is a main-process call. The preload
must not be replaced with anything; no data has to be passed through the URL either — the
only data is the image, already passed as a `file://` URL in the generated HTML.

Note for CP4: the temp HTML lives in `%TEMP%`, and with no preload it has no bridge. The Q6
sender guard already denies it (it is not the main window's main frame), so this is
defence in depth rather than the only layer.

## 6. Installer build

`package.json:17`: `"build:win": "npm run build && electron-builder --win"`.

- `npm run build` = `tsc && vite build` (with the `prebuild` → `prepare:scanner` step).
- `electron-builder --win` uses the `build` block in `package.json:35-56`: `appId
  com.adzu.registrar.archive`, `productName "AdZU Registrar Archive"`, `win.target: ["nsis"]`,
  `win.icon src/assets/adzu-seal.png`, `directories.output "release"`, and an explicit
  `files` list (`dist/**/*`, `electron/**/*`, `node_modules/**/*` minus three dev packages,
  `package.json`).
- Artifacts: `release/win-unpacked/AdZU Registrar Archive.exe` (what `afterPack` will be
  handed) and the NSIS installer under `release/`.
- No `asar`, `afterPack`, `afterSign`, `extraResources` or `protocols` key exists today, so
  this phase adds the first build hook.

## 7. `@electron/fuses`

```
$ npm ls @electron/fuses
adzu-registrar-archive@1.0.0 D:\…\registrar-archiving-system
└── (empty)
```

`node_modules/@electron/fuses` does not exist and no `fuse`-named package is installed
(`node_modules/@electron/` holds only `asar`, `get`, `node-gyp`, `notarize`, `osx-sign`,
`rebuild`, `universal`). **CP6 needs an install and must stop for your approval before
doing it**, per the phase prompt. electron-builder 24 resolves the `afterPack` config key
as a module path (`node_modules/app-builder-lib/out/packager.js:438-443` →
`resolveFunction(this.appInfo.type, this.config.afterPack, "afterPack")`), so a
`scripts/afterPack.cjs` referenced by name works; `package.json` is `"type": "module"`,
so the hook must be `.cjs` to use `require('@electron/fuses')`.

## 8. What this phase will change, and the constraints found

| CP | Item | Current state | Constraint found in the code |
| --- | --- | --- | --- |
| CP2 | Q1 production = packaged | `usesDevServer` is `NODE_ENV \|\| !isPackaged` (§1) | The same boolean feeds `createUrlPolicy` (`main.cjs:21-24`), so the Q6 sender guard must follow the new constant too, or dev mode's IPC would be denied. |
| CP3 | Q2 DevTools lock | `openDevTools()` unconditionally in dev branch; default menu present; no key filter | `devTools: false` also blocks `openDevTools()`, so the call must stay inside the dev branch. `before-input-event` must not intercept typing: only the six listed shortcuts, and only when packaged. |
| CP4 | Q4 print window without bridge | print window carries `PRELOAD_PATH` (§5) | Print page has no script and calls no IPC, so removal is behaviour-neutral; keep `sandbox/nodeIntegration/contextIsolation` as they are. |
| CP5 | Q7 navigation, pop-ups, permissions | nothing installed (§3, §4) | Permission handlers are session-scoped, so they must be set on the main window's `session` (the print window shares it but runs no script). Reuse the Q6 URL policy for `will-navigate` instead of writing a second URL rule. |
| CP6 | Q13 fuses | not installed (§7) | Install needs your approval. Only `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments` are in scope; ASAR-integrity and cookie-encryption fuses need changes this phase does not make. |

## 9. Checked against the docs (rule 13)

| Claim | Current code |
| --- | --- |
| `HANDOFF.md` §10 row 11: "README says `contextIsolation: true`, `nodeIntegration: false`; VERIFY `sandbox`, CSP, `will-navigate`, `setWindowOpenHandler`, IPC sender checks, print window hardening" | `contextIsolation`/`nodeIntegration` confirmed (`main.cjs:41-42`); no CSP (`index.html:1-12`); no `will-navigate`/`setWindowOpenHandler`; sender check added in P1A (`main.cjs:26-32`); print window explicitly `sandbox: true` but still carries the preload |
| Register R11: "DevTools open whenever the app is unpackaged" | Confirmed, and wider than stated: open whenever `NODE_ENV=development` **or** unpackaged (`main.cjs:17,58`), so a packaged build with the env var set also opens them |
| Register R12: "Print window loads the app preload into a generated temp HTML file" | Confirmed (`files.ipc.cjs:226`) |
| Register §11: main-window `sandbox` "effective value (not set explicitly; Electron defaults it on)" | Still not set. The typings only document the option, not the default; this phase does not change it (out of scope) |
| Register R20: packaged route URLs `file:///D:/`, `file:///D:/students` | Unchanged; CP5's `will-navigate` must reuse that policy so a packaged reload of a route URL is not blocked |

No doc statement contradicted the code. The one correction is that R11 understates the
DevTools reach (env var, not just unpackaged).
