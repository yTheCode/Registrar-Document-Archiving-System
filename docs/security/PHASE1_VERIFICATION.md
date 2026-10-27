# Phase 1 verification — Q1 to Q13

Branch `security/p1d-docs-and-verify`, based on `origin/main` at `b6ea594` (Phase 1A, 1B and 1C
merged). Commit IDs and messages below were read from `git log`, and test files from the `tests/`
folder, on 2026-10-27. Nothing in this table is from memory.

Status values: **done** (code + automated test, and a manual check below), **manual** (no code
change belongs in this repository; the owner must perform it on each installed copy). There are no
items in the "not implemented" state: Q8 and Q9 are `manual: not implemented here` because they
are operational steps, not missing features.

## 1. The thirteen rows

| Q | Item | Status | Commit (real message) | Test file | Manual check |
| --- | --- | --- | --- | --- | --- |
| **Q1** | Production is decided by `app.isPackaged` alone, so `NODE_ENV=development` cannot point an installed copy at the Vite dev server | done | `b2c7c07 p1b cp2: production mode is packaged, never an environment variable` | `tests/electron/security/runtimeMode.test.ts` (7 tests) | Packaged app started with `NODE_ENV=development`: window shows the app from `dist/index.html`, no DevTools. `npm run dev` still loads `localhost:5173` with DevTools |
| **Q2** | A packaged build has no DevTools, no application menu and no reload/DevTools shortcuts | done | `f2ffeb0 p1b cp3: packaged builds lose DevTools, the menu and the reload shortcuts` | `tests/electron/security/blockedKeys.test.ts` (9), `tests/electron/security/devToolsWiring.test.ts` (5) | Packaged app: F12, Ctrl+Shift+I, Ctrl+Shift+J and Ctrl+R do nothing, F5 does nothing, no menu bar (Alt shows none). Dev: DevTools still opens, F5 still reloads |
| **Q3** | `file:copy` accepts only files the user picked in the Open dialog, and only absolute paths | done | `7c168b9 p1c cp2: only files picked in the Open dialog can be copied in`<br>`76d9150 p1c cp2b: reject non-absolute source paths in file:copy` | `tests/electron/security/pickedFiles.test.ts` (24 tests) | A dialog-picked import still works. In DevTools, `window.electronAPI.copyFile('C:\\Windows\\win.ini', <archive path>)` returns `{ success: false }` and copies nothing |
| **Q4** | The hidden print window no longer receives the app preload (47 bridge methods) | done | `2533f48 p1b cp4: the hidden print window gets no preload` | `tests/electron/security/printWindowWiring.test.ts` (4 tests) | Print an image document: the print dialog appears and the page is fit-to-page. Print a PDF: it opens in its default app. Both unchanged |
| **Q5** | The main process remembers who logged in; `isAdmin` requires that account and a live, active admin row | done | `91f4136 p1a cp2: add the pure session and admin-decision modules`<br>`cc015df p1a cp3: make the main process remember who logged in` | `tests/electron/security/session.test.ts` (11), `adminDecision.test.ts` (9), `authWiring.test.ts` (10) | Log in as `user`: `await window.electronAPI.getAllUsers(1)` returns `success:false`. Log in as `admin`: it succeeds. Log out: it fails again. Deactivate an admin: their next guarded call fails |
| **Q6** | Every IPC channel first checks that the call comes from the main window's main frame on the app's own page | done | `2ada6a6 p1a cp4: only the app's own main window page may call IPC`<br>`d89a962 p1a cp5: pin IPC guard coverage and record Q5/Q6 in the register` | `tests/electron/security/senderGuard.test.ts` (14), `urlPolicy.test.ts` (13), `ipcGuardWiring.test.ts` (10) | Packaged app: login, student search, import and print still work (all 47 channels reachable from the app's page); a second window loading a local `evil.html` gets `Permission denied` |
| **Q7** | Pop-ups, away-navigation, `<webview>` and every permission except camera **video** are denied | done | `89dc8df p1b cp5: no pop-ups, no outside navigation, camera-only permissions`<br>`efd81d7 p1b cp5b: allow device names in the permission check`<br>`7263ae2 p1b cp5c: allow media permission checks so device names show`<br>`8f1033f p1b cp5d: note the camera permission diagnosis` | `tests/electron/security/navGuard.test.ts` (17), `navGuardWiring.test.ts` (6) | `window.open('https://example.com')` and an outside link do nothing. The camera dropdown lists real device names and the feed works. `getUserMedia({ audio: true })` fails |
| **Q8** | Change the seeded default passwords on every installed copy | manual: not implemented here | — (no code: the repository seeds them by design; the app has **no** password-change feature) | — | **1.** Log in as the default `admin`, create a new admin account with a strong password, log in as it, and confirm it has full admin access.<br>**2.** Deactivate the default `admin` and `user` accounts from the new admin and confirm neither can log in. The team must first confirm each step is possible in the UI: since no password-change channel or screen exists, new account + deactivation is the only route |
| **Q9** | Turn on disk encryption for the data at rest | manual: not implemented here | — (no code; data stays plaintext by design, see register R16) | — | **1.** Enable BitLocker for the drive that holds `%APPDATA%\adzu-registrar-archive` (database) and the configured archive root, and store the recovery key in the office's escrow.<br>**2.** Restart the app, log in, import one document and open it, then record the recovery-key location in the handover notes |
| **Q10** | README, HANDOFF and the SRS/slides material match the build | done | `6f5a98d p1d cp2: list the README and HANDOFF claims that no longer match the code`<br>`6b0d4f2 p1d cp2b: align README and HANDOFF wording with the code`<br>`043c751 p1d cp3: verified statements for the SRS and slides`<br>`b211103 p1d cp3b: add the reload caveat to the smoke test`<br>`0d25e90 p1d cp3c: show installed versions in the README stack table` | none — documentation only; every number can be re-derived with the commands in `docs/security/p1d-srs-slides-notes.md` §6 | Re-run three counts and compare with `docs/security/p1d-srs-slides-notes.md` §1: `grep -c "ipcRenderer.invoke" electron/preload.js` → 47; `grep -rh "ipcMain.handle(" electron/ipc/*.cjs \| wc -l` → 47; `npm test` → 28 files / 304 tests |
| **Q11** | One archive-root default and one resolver for imports, opens, folder naming, backups and restores | done | `7570837 p1c cp3: one archive root for scans, backups and restores`<br>`3a79bf1 p1c cp4: cross-check test for one archive root and register entries` | `tests/electron/security/archiveRoot.test.ts` (8), `archiveRootWiring.test.ts` (23), `oneArchiveRoot.test.ts` (6) | With the `archive_directory` row deleted: import a document, open an old one and run `backup:create` — all use `%APPDATA%\adzu-registrar-archive\Archive` and the ZIP contains an `Archive` folder. `setSetting('archive_directory', 'C:\\temp', 1)` returns the Archive Location refusal |
| **Q12** | `formatDate` / `formatTimestamp` return a placeholder instead of throwing on a bad value | done | `1d0c231 p1d cp1: show a placeholder instead of throwing when a date is invalid`<br>`988eb96 p1d cp1b: show a placeholder instead of throwing in formatTimestamp` | `tests/utils/format.test.ts` (17 tests) | In a test DB run `UPDATE documents SET created_at='garbage' WHERE id=…` and `UPDATE activity_logs SET created_at='garbage' WHERE id=…`. Students, Search and Dashboard show `Unknown date`; Logs shows `Unknown time`; every list still renders |
| **Q13** | The Windows exe ships with `RunAsNode`, `NODE_OPTIONS` and `--inspect` fuses off | done | `b15ee73 p1b cp6: flip the Node fuses off in the built exe` | `tests/scripts/afterPack.test.ts` (9 tests) | On the installed app: `set ELECTRON_RUN_AS_NODE=1` then run the exe — the normal window opens (no Node shell). Without the variable, login, scan and print still work. `npm run build:win` must be re-run first (pending) |

## 2. Check results (this branch, 2026-10-27)

| Check | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | **PASS** — `tsc --noEmit`, no output |
| Build | `npm run build` | **PASS** — `tsc && vite build`, built in ~3.5 s (`dist/assets/index-BGteLuHK.js` 412.34 kB, gzip 114.43 kB) |
| Tests | `npm test` | **PASS** — 28 files, 304 tests, 0 failures (~2.3 s) |
| Lint | `npm run lint` | **PASS (warnings only)** — 0 errors, 112 warnings; every rule is set to `warn` by design |
| Other check scripts | — | None: `package.json` has no separate check/test-lint script. `npm run prepare:scanner` runs automatically through `prebuild`/`postinstall` and only copies the scanner assets |
| Packaging | `npm run package` / `electron-builder` | **Not run here** by instruction; the owner builds and tests the installer |

Baseline for comparison (register §1, S0): 9 files / 109 tests, 0 errors / 112 warnings. The
warning count is unchanged; the suite grew by 19 files and 195 tests.

## 3. Manual checks still outstanding

Q1–Q7 and Q13 need a **packaged** build (`npm run build:win`, then install) for their manual
checks; the development run only proves the dev half. Q8 and Q9 have no automated proof at all and
must be done on each installed copy. Q10, Q11 and Q12 can be checked in `npm run dev`.
