# Security Register — adzu-registrar-archive

Tracks the security phase (S0–S6, see `HANDOFF.md` §11). One row per risk. Every
finding below was checked against the code on branch `security/s0-baseline`
(commit `7d285f0`, equal to `origin/main`), not against the older snapshot
`04cba01` the original review used. Line numbers are for that commit.
Rows marked Q5/Q6 and R18–R20 were added on `security/p1a-identity` (Phase 1A);
R21–R23 and the Q1/Q2/Q4/Q7/Q13 statuses were updated on
`security/p1b-electron-hardening` (Phase 1B). For those, treat a cited
`file:line` as the S0 location and rely on the named symbols for the current one.

Status values: `open` · `fixed` · `accepted` (risk accepted, documented) ·
`verify` (needs a hands-on or version check before it can be closed).

## 1. Baseline (S0)

| Item | Value |
| --- | --- |
| Branch | `security/s0-baseline` |
| Base commit | `7d285f0` (`origin/main`) |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | PASS — 9 files, 109 tests |
| `npm run lint` | 0 errors, 112 warnings |
| App code changed in S0 | none |

## 2. Assets

| Asset | Where | Why it matters |
| --- | --- | --- |
| Student PII | `students` table in SQLite | Names, student IDs, program level, school year |
| Scanned documents | archive folder on disk | Transcripts, medical/law records, birth certificates |
| Account credentials | `users.password_hash` (bcrypt, cost 10) | Admin and user accounts |
| Audit trail | `activity_logs` table | Who did what; used to investigate misuse |
| Configuration | `settings` table | `archive_directory` decides where files are read/written |
| Backups | user-chosen `.zip` files | Contain the whole DB (hashes) and the archive |

## 3. Trust boundaries

1. **Renderer → main (IPC).** 46 channels, all reachable from any renderer that
   has the preload bridge. The renderer is treated as untrusted in this phase.
2. **Main → filesystem.** The archive folder is user-configurable and may sit on
   a network share or a junction.
3. **Main → OS shell.** `shell.openPath` / `showItemInFolder` launch whatever the
   OS associates with a file.
4. **App → backup file.** A backup ZIP can come from another machine and is
   imported wholesale.
5. **OS account boundary.** The app stores everything as the logged-in Windows
   user. There is no encryption and no second factor.

## 4. Threat model (one page)

**Deployment assumed.** Single-seat, offline Windows desktop app for the
Registrar's Office. No network listener, no remote content loaded in production.
Several staff may share one Windows account, which is why the app has its own
login.

**Actors.** (a) a staff member using the app normally; (b) a compromised
renderer, i.e. script injected through loaded content or a dependency; (c) a
person at the keyboard who has a normal Windows account and the app open;
(d) a malicious or corrupted backup file; (e) an unpatched dependency or an
Electron version below support; (f) a thief with the disk.

**Out of scope.** OS administrators, physical attack on an unlocked machine,
BitLocker bypass, camera/printer driver bugs, and network attacks (the app has
no inbound network surface).

**Key threats.**

| # | Threat | Impact | Phase |
| --- | --- | --- | --- |
| T1 | Renderer supplies any `userId` to an admin-guarded handler and passes the `isAdmin` check | Full admin control (delete, purge, user management) | S1 |
| T2 | Renderer calls an unguarded channel to read students, documents, settings | PII disclosure without login | S1 |
| T3 | Renderer asks main to copy an arbitrary local file into the archive, then reads it back | Arbitrary local file disclosure | S2 |
| T4 | Contained-path check bypassed with a junction/symlink, UNC path, trailing dot or 8.3 name | Read/write/delete outside the archive | S2 |
| T5 | Huge base64 payload over IPC | Memory exhaustion, app crash | S2 |
| T6 | Stored `.exe`/`.lnk`/`.bat` launched through open/print | Local code execution | S3 |
| T7 | Default seeded credentials (`admin`/`admin123`, `user`/`user123`) never changed; no login throttling | Trivial login as admin | S1/S3 |
| T8 | Renderer writes audit entries with any `action`/`userId` | Audit trail forged, investigation misled | S4 |
| T9 | Hostile backup ZIP (zip-slip entries, DB that points the archive at a real folder) | File overwrite/delete outside the archive | S4 |
| T10 | Unpatched Electron 28 and vulnerable npm packages | Memory-corruption or RCE class bugs | S5 |
| T11 | Disk or backup stolen | Plaintext student data | S6 |

**Current mitigation shape.** Authorization is a per-handler `isAdmin(userId)`
that must match the main-process session and re-reads the account's
`role`/`status` (Q5), and every handler registered through
`electron/ipc/index.cjs` first checks that the call comes from the main
window's main frame on an allowed page (Q6). Path containment is string-based
(`path.resolve` + `path.relative`). Process hardening: the runtime mode is
decided by `app.isPackaged` alone (Q1), so an environment variable cannot point
an installed copy at a dev server; a packaged build has no DevTools, no
application menu and no reload/DevTools shortcuts (Q2); the main window denies
pop-ups, away-navigation and `<webview>` attachment and opens only camera
streams, while media checks are granted so device names appear (Q7); the hidden
print window has no preload (Q4). The Windows exe has
`RunAsNode`, `NODE_OPTIONS` and `--inspect` fuses off (Q13). Hardening still
relies on `contextIsolation: true`, `nodeIntegration: false` and the sandbox
default; **there is still no CSP** (later work). Destructive actions (purge,
delete, restore) rely on the UI for confirmation, except archive purge, which
re-checks the password in main.

## 5. IPC authorization inventory (verified)

Inventory below describes the S0 baseline; it was re-verified channel by channel
in `docs/security/p1a-authz-analysis.md` and the Q5/Q6 changes are summarised at
the end of this section.

- 46 `ipcMain.handle` channels; 46 methods in `electron/preload.js`.
- 27 channels call `isAdmin(...)`; 19 do not.
- **At S0 no main-process session existed.** `auth:login` (`electron/ipc/auth.ipc.cjs:8`)
  returns `{ id, username, role }`; the renderer stores it in `sessionStorage`.
  Every admin check trusted a `userId`/`createdBy`/`updatedBy`/`deletedBy`
  argument, so any renderer could present any account id.

Unguarded channels (18, excluding `auth:login` which must stay public):

| Channel | Evidence | Exposes |
| --- | --- | --- |
| `students:getAll`, `students:search`, `students:getById`, `students:getFilterOptions` | `electron/ipc/students.ipc.cjs:9,21,50,36` | Student PII |
| `documents:search` | `electron/ipc/documents.ipc.cjs:279` | Document metadata |
| `documentTypes:getAll` | `electron/ipc/documentTypes.ipc.cjs:8` | Low |
| `settings:get` | `electron/ipc/settings.ipc.cjs:7` | Any setting, incl. archive path |
| `dashboard:getStats` | `electron/ipc/dashboard.ipc.cjs:7` | Recent documents + counts |
| `file:copy`, `file:openExternal`, `file:showInFolder`, `file:readAsBase64`, `file:print`, `file:readPickedAsBase64` | `electron/ipc/files.ipc.cjs:13,39,59,79,171,136` | Document files, OS shell |
| `image:saveBase64` | `electron/ipc/images.ipc.cjs:11` | Archive writes |
| `folders:generatePath` | `electron/ipc/folders.ipc.cjs:11` | Directory creation |
| `dialog:openFile`, `dialog:openDirectory` | `electron/ipc/dialogs.ipc.cjs:9,19` | User-driven dialogs |

Guarded channels still accept the actor id from the renderer, so at S0 they were
only as strong as T1 allowed.

**After Q5/Q6 (P1A, branch `security/p1a-identity`).** 47 channels now: 27
admin-guarded, 2 session-only (`auth:login`, `auth:logout`) and the 18 above.
Q5 added `electron/security/session.cjs`; `auth:login` sets it on success,
`auth:logout` and the main window's `closed` event clear it, and `isAdmin`
returns true only when the argument equals the session's user *and* the re-read
row is an active admin (`electron/services/authz.cjs`). Q6 wraps `ipcMain.handle`
once in `electron/ipc/index.cjs`, so every channel runs the sender guard
(`electron/security/senderGuard.cjs`) first and returns
`{ success: false, error: 'Permission denied' }` unless the call comes from the
main window's main frame on an allowed page. The 18 unguarded channels are
unchanged: they still need no login (R3, out of scope for Q1–Q13).

## 6. Risk register

| ID | Risk | Verified evidence | Sev | Phase | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | Admin checks trust a renderer-supplied id | `electron/services/authz.cjs:6-10`; 27 call sites across `electron/ipc/*` | Critical | S1 | fixed (Q5, cp3) — `isAdmin` now requires `session.isCurrentUser(userId)` and re-reads `role, status` |
| R2 | No main-process session; login is a renderer-side fact | `electron/ipc/auth.ipc.cjs:8-37`; `src/App.tsx:31,40,45` (sessionStorage) | High | S1 | fixed (Q5, cp3) — session set on login, cleared on logout/window close; residual R18 |
| R3 | 18 data/file channels need no login | table in §5 | High | S1 | open — Q6 limits them to the app's own window page, but they still require no login |
| R4 | Default accounts seeded at first run and printed on the login screen (and in the README) | `electron/db/connection.cjs:117-134`; `src/pages/Login.tsx:210-219`; `README.md:754-759` | High | S1 | open |
| R5 | No login throttling or lockout; synchronous bcrypt compare | `electron/ipc/auth.ipc.cjs:16` | Medium | S1 | open |
| R6 | `file:copy` validates only the destination; `sourcePath` may be any local file, then `file:readAsBase64` reads it back | `electron/ipc/files.ipc.cjs:13-33` (copy at :32) | High | S2 | open |
| R7 | Path containment is string-only: no `realpath`, so junctions/symlinks escape; Windows case/trailing-dot/8.3/UNC forms are not normalised | `electron/services/archivePaths.cjs:8-26,36-45` | High | S2 | open |
| R8 | No extension allowlist on open/import: `openExternal`, `print` and `exportCopy` will hand any stored file to the OS handler | `electron/ipc/files.ipc.cjs:52,193,286` | Medium | S3 | open |
| R9 | No size or type limits on base64 IPC (`readAsBase64` reads whole files; `image:saveBase64` decodes any length) | `electron/ipc/files.ipc.cjs:91`; `electron/ipc/images.ipc.cjs:31` | Medium | S2 | open |
| R10 | Audit entries are written from renderer-driven handlers with a renderer-supplied actor and free-text action; `logs:add` accepts any `action` | `electron/ipc/logs.ipc.cjs:8-17` | Medium | S4 | open |
| R11 | No CSP in `index.html`; no `will-navigate` / `setWindowOpenHandler`; DevTools open whenever the app is unpackaged | `index.html:1-12`; `electron/main.cjs:29-34` | Medium | S3 | fixed in part (Q2 cp3, Q7 cp5) — a packaged build has no DevTools, no menu and no DevTools/reload shortcuts, and the main window denies pop-ups, away-navigation and webviews; **CSP is still absent** (open) |
| R12 | Print window loads the app preload (`PRELOAD_PATH`) into a generated temp HTML file | `electron/ipc/files.ipc.cjs:218-228` | Low | S3 | fixed (Q4, cp4) — the print window has no preload and the temp page contains one `<img>` and no script |
| R13 | `folders:generatePath` accepts a renderer-supplied `archiveRoot` and `mkdir`s under it (type name is sanitised, only file writes are re-validated) | `electron/ipc/folders.ipc.cjs:11-13`; `electron/services/folderNaming.cjs:35-42,68` | Medium | S2 | open |
| R14 | Backup restore extracts a ZIP to temp, then trusts the archive path stored inside the backup DB; `isSafeArchiveTarget` is an exact match against a forbidden list, so subfolders of Documents pass | `electron/ipc/backup.ipc.cjs:148,158,161`; `electron/services/backup.cjs:11-23` | Medium | S4 | verify |
| R15 | Electron 28.3.3 (out of support) and 27 unresolved npm advisories | §7 below; `package.json` (`electron ^28.1.0`) | High | S5 | open |
| R16 | Archive data is plaintext on disk and in backups | `electron/db/connection.cjs:41`; backup ZIP has no password | Medium | S6 | open |
| R17 | Archive-root fallback differs: `getArchiveRoot()` → `Documents/ADZU_Archive`, DB init/`resolveArchiveDir` → `userData/Archive` | `electron/services/archivePaths.cjs:30`; `electron/db/connection.cjs:163`; `electron/services/backup.cjs:27` | Low | S2 | open |
| R18 | A renderer reload (Ctrl+R, crash recovery) drops `sessionStorage` but not the main-process session | `electron/security/session.cjs`; `auth:logout` and the window `closed` event are the only clears (`electron/ipc/auth.ipc.cjs`, `electron/main.cjs`) | Low | S1 | accepted — the UI shows the login screen while the window stays authorized for the previous user; reaching a guarded channel then needs renderer code execution |
| R19 | `backup:restore` swaps the users table under a live session | `electron/ipc/backup.ipc.cjs:114`; the session keeps its `userId`, and `isAdmin` re-reads that id's row in the restored DB | Low | S1 | accepted — restore is admin-guarded and the renderer offers no forced re-login (`src/pages/Settings.tsx`); a restored DB that reuses the id decides the session's new authority |
| R20 | Sender URL check is a second layer behind the main-frame identity check | `electron/security/senderGuard.cjs`; under BrowserRouter the measured packaged route URLs (`file:///D:/`, `file:///D:/students`) differed from `dist/index.html`, so the policy also allows one flat segment under a drive root | Low | S3 | resolved (P1B cp7) — the renderer now mounts `HashRouter`, so a packaged route keeps the `dist/index.html` document URL and changes only the fragment, which the policy ignores when matching the file. The policy still admits only the app's own `index.html`, and no rule was loosened. |
| R21 | Production mode was `NODE_ENV === 'development' \|\| !app.isPackaged`, so `NODE_ENV=development` pointed an installed copy at `http://localhost:5173` and opened DevTools | `electron/main.cjs` (S0: the `isDev` line and `openDevTools`) | High | S3 | fixed (Q1, cp2) — `electron/security/runtimeMode.cjs` derives dev only from `app.isPackaged === false`; the dev-server URL and DevTools follow it |
| R22 | No permission handlers: any renderer page could request the microphone, notifications, display capture or other permissions | `electron/main.cjs` (S0: no `setPermissionRequestHandler`) | Medium | S3 | fixed (Q7, cp5/cp5b, follow-up) — `electron/security/navGuard.cjs`: the request handler grants `media` only with `mediaTypes` exactly `["video"]`; the check handler grants any `media` check, whatever the `mediaType` (missing, `unknown`, `video` or `audio`). **Why:** Chromium hides every device name unless the microphone name check passes, so denying it emptied the camera list as well (measured: `enumerateDevices()` returned a single unnamed entry while the camera feed worked). A check opens no stream, and microphone streams are still blocked by the request handler; the names of microphones and speakers are therefore visible to the app's own page. Every non-media permission stays denied. |
| R23 | Electron fuses left at defaults: `ELECTRON_RUN_AS_NODE=1` turns the installed exe into a Node shell, and `NODE_OPTIONS` / `--inspect` can inject code into the main process | `package.json` (S0: no `afterPack`, no `electronFuses`) | High | S3 | fixed (Q13, cp6) — `scripts/afterPack.cjs` flips `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments` off in the Windows exe; needs the installer smoke test (run `ELECTRON_RUN_AS_NODE=1` on the built exe) |

R17 is an integrity issue rather than an attacker-controlled one; it is listed
because a missing setting silently splits reads from backup paths.

Two notes on R20 (P1B cp7): the flat drive-root route allowance measured under
BrowserRouter is now unused and could be removed as a future tightening; and a custom
`app://` protocol with BrowserRouter remains a possible future improvement, since it
would give the renderer a real origin instead of a `file://` document.

## 7. Dependency audit triage (S0 cp2)

Run on 2026-10-26 against the installed tree with `npm audit` and
`npm audit --omit=dev`. Nothing was installed, removed or patched.

| Measure | Result |
| --- | --- |
| `npm audit` | 27 advisories: **4 critical, 17 high, 6 moderate**, 0 low |
| `npm audit --omit=dev` | 2 moderate (`react-router`, `react-router-dom`) |
| Tree size | 137 prod, 605 dev, 742 total packages |
| HANDOFF §12 recorded | 23 (4 moderate / 17 high / 2 critical) — the advisory database has grown since that snapshot |

`--omit=dev` **understates** this app: `electron` is declared in
`devDependencies` but it is the shipped runtime, so treat the Electron group as
runtime.

| Group | Installed packages | Worst severity | In the installer? | Practical exposure | Fix |
| --- | --- | --- | --- | --- | --- |
| Electron runtime | `electron@28.3.3` (46 advisories) | high | **yes** (the shell itself) | Includes context-isolation bypass via `Function.prototype.bind`, sandboxed-iframe popup escapes, `shell.openPath` null-byte bypass, Windows `setLoginItemSettings` unquoted path | `electron@41.7.1` (major); needs `npm run rebuild` + installer check |
| Renderer prod deps | `react-router-dom@6.30.6`, `react-router@6.30.6` | moderate | **yes** | Open redirect via backslash needs an attacker-controlled link/navigate target; the app uses static routes and has no `useNavigate` call. The SSR-hydration advisory does not apply | `react-router-dom@7.18.4` (major) |
| Install script | `extract-zip@2.0.1` (under `electron`) | high | no — runs at `npm install` | Symlink/zip traversal while unpacking Electron's own download on the build machine | arrives with Electron 41 |
| Packaging | `electron-builder@24.13.3`, `app-builder-lib`, `builder-util`, `builder-util-runtime`, `dmg-builder`, `electron-publish`, `electron-builder-squirrel-windows` | high | no | Build machine only: installer assembly | `electron-builder@26.18.0` (major) |
| Rebuild toolchain | `@electron/rebuild@3.7.2`, `@electron/node-gyp` (git), `make-fetch-happen@10.2.1`, `cacache@16.1.3`, `http-cache-semantics@4.2.0`, `ip-address@10.7.2`, `tar@6.2.1` | critical (`tar`), high | no | Runs only for `npm run rebuild`; tar extraction of downloaded headers/tarballs | npm suggests `@electron/rebuild@0.0.0`, which is not a real version — resolve after the Electron upgrade |
| Dev server | `vite@5.4.21`, `esbuild@0.21.5` | high | no | Localhost dev server on Windows: `server.fs.deny` bypass, launch-editor UNC/NTLM disclosure and argument injection | `vite@6.4.5` (major, coordinate with Vitest) |
| Test tooling | `vitest@2.1.9`, `tinypool@1.1.1`, `@vitest/mocker`, `vite-node` | critical (tinypool prototype-pollution → RCE; Vitest UI arbitrary file read) | no | Only if the Vitest UI server is exposed; this repo runs `vitest run` | `vitest@4.1.12` (major, needs Vite 6/7) |
| Dev script | `shell-quote@1.10.0` (under `concurrently`) | critical | no | `concurrently` launches fixed strings from `package.json`; no untrusted token reaches `quote()` | npm reports a fix, no version given |
| Dev polling | `follow-redirects@1.16.0` (`wait-on` → `axios`) | high | no | Polls `http://localhost:5173` only | npm reports a fix, no version given |
| Build-time maps | `source-map-js@1.2.1` (Tailwind, PostCSS, jsdom) | high (DoS) | no | Needs malicious indexed source maps during a build | npm reports a fix, no version given |

**Conclusion.** Only two groups can affect an installed copy: the Electron binary
(high) and the router (moderate, not currently reachable). Every other advisory
is limited to the build or developer machine, and every offered fix is a
major-version bump, so none belongs in S0. `npm audit fix --force` remains
forbidden.

**S5 order.** Electron 41 + `npm run rebuild` + installer smoke test first;
then `react-router-dom` 7; then `vite` 6 and `vitest` 4 together; then
`electron-builder` 26 and `@electron/rebuild` 4. Re-run `npm audit` and
`npm audit --omit=dev` after each step.

## 8. Git history and secret check (S0 cp3)

Scope: every ref in this clone — 5 local branches, `origin/main`,
`origin/kennettlao-security-patch-1`, 6 tags — 32 commits, 252 objects,
158 blobs, and no unreachable or dangling objects (`git fsck --unreachable`
is empty). Read-only: nothing rewritten, deleted or pushed.

| Check | Basis | Result |
| --- | --- | --- |
| Database / archive / key files by extension | `git rev-list --objects --all` plus name filter (`db`, `db-wal`, `db-shm`, `sqlite`, `zip`, `7z`, `rar`, `tar`, `gz`, `bak`, `pem`, `p12`, `pfx`, `key`, `jks`, `keystore`, `kdbx`, `env`, `npmrc`, `netrc`, `pgpass`, `ovpn`, `pdf`, `docx`, `xlsx`, `csv`, `dcm`, `tif`) | **0 matches** |
| Sensitive directories / dotfiles | `database/`, `Archive/`, `archives/`, `backup(s)/`, `students/`, `documents/`, `uploads/`, `secrets/`, `credentials/`, `.env*`, `id_rsa*`, `.npmrc`, `.netrc`, `.git-credentials`, `credentials.json` | **0 matches** |
| File contents | 10 high-signal patterns over all 158 blobs: private-key headers, AWS keys, GitHub/Slack/Google/Stripe tokens, JWTs, URLs with embedded credentials, `password/secret/token/api_key = "..."` assignments, literal `Bearer` tokens | **0 matches** |
| Commit messages | `git log --all` filtered for password/secret/token/credential wording | **0 matches** |
| Largest blobs | seal PNG 381 kB, `package-lock.json` 357 kB, then source and notes | no data dumps |
| Ignore rules on `origin/main` | `*.db`, `*.db-wal`, `*.db-shm`, `.env`, `Archive/`, `archives/`, `dist/`, `release/`, `node_modules/`, `public/scanner/` | present |
| Working tree | root dotfiles, `git status --ignored` | no `.env` or `.npmrc`; only `dist/`, `node_modules/`, `public/` are ignored |

Scanner validation: the blob reader was checked against a known literal
(`admin123`), which it found in five paths, so the zero result is a real
negative rather than a parsing failure.

**Committed credential material (not a leaked secret, still exposed).** The
default accounts are hardcoded at `electron/db/connection.cjs:117-134`, the
login screen prints them unconditionally in production
(`src/pages/Login.tsx:210-219`), and `README.md:754-759` documents them. This
extends R4: anyone who reaches the login screen is handed working administrator
credentials. Recorded for S1; not changed in S0.

**Not verifiable from this clone.** GitHub repository visibility, and the older
pre-restart repository named in `HANDOFF.md` §9. Only one remote is configured
(`yTheCode/Registrar-Document-Archiving-System`). Both need a manual check on
GitHub.

## 9. Controls that are already right (keep them)

- `contextIsolation: true`, `nodeIntegration: false`, single-file preload, no
  remote content in production (`electron/main.cjs:18-22`).
- Login returns only `id`/`username`/`role`, never the hash, and gives the same
  error text for unknown user and wrong password (`electron/ipc/auth.ipc.cjs:12-33`).
- `archive:purgeAll` re-checks the acting admin's password in the main process
  (`electron/ipc/archive.ipc.cjs:33-39`). This corrects the HANDOFF item marked
  "VERIFY" — the check is present.
- Backup restore proves the ZIP's DB is a real SQLite file with the required
  tables before touching the live DB, and keeps a safety copy
  (`electron/services/backup.cjs:33-57`; `electron/ipc/backup.ipc.cjs:158-181`).
- Pre-import previews are limited to files the user picked in a dialog and block
  a forbidden-directory list (`electron/ipc/files.ipc.cjs:123-145`).
- SQL sort columns are whitelisted; user text is parameterised (no interpolation
  of values) in students/documents/logs queries.
- `runMigrations`/`buildStudentSearchFilter` tests pin current SQL-builder
  behaviour, including known flaws (`tests/electron/services/studentQueries.test.ts`).

## 10. Corrections to HANDOFF §10 (current code differs)

| HANDOFF claim | Current code |
| --- | --- |
| `archive:purgeAll` password check: "VERIFY … in main" | Verified present, `archive.ipc.cjs:33-39` |
| `logs:add` "callable from the renderer", listed as unchecked | It is admin-guarded (`logs.ipc.cjs:10`), but the actor id is renderer-supplied, so T8/R10 still stands |
| Unguarded list omits `file:print`, `students:getById`, `dialog:*`, `documentTypes:getAll` | All four are unguarded as well |

## 11. S0 remaining items

- **npm audit triage** — done in S0 cp2, see §7. No fix applied.
- **Git history check** — done in S0 cp3, see §8. No committed database,
  archive, student data, key or token file; no secret pattern in any blob. No
  history rewrite.
- **GitHub repository visibility and the pre-restart repository** — manual
  check on GitHub; not visible from this clone (§8).
- **Confirm at their phase:** main-window `sandbox` effective value (not set
  explicitly; Electron defaults it on), `adm-zip@0.6.1` zip-slip behaviour during
  extraction, junction/UNC behaviour on the archive path, and the installer
  build (`npm run build:win` has not been re-run since the refactor).
- **CSP** — not added in P1B (later work); R11 stays partly open for it.
- **P1B manual smoke test** — on the built installer: F12/Ctrl+Shift+I do nothing,
  there is no menu bar, `NODE_ENV=development` does not load localhost:5173,
  camera scan and print still work, an outside link/`window.open` does nothing,
  and `ELECTRON_RUN_AS_NODE=1` does not produce a Node shell (R21–R23).

## 12. Phase log

| Date | Checkpoint | Change |
| --- | --- | --- |
| 2026-10-26 | S0 cp1 | Created this register: S0 baseline, threat model, verified IPC inventory, 17 risks, HANDOFF corrections. No application code changed. |
| 2026-10-26 | S0 cp2 | npm audit triage (§7): 27 advisories, only Electron and the router reach the installer, all fixes are major bumps deferred to S5. No dependency changed. |
| 2026-10-26 | S0 cp3 | Git history and secret check (§8): no committed database, archive, student data, key or token file; no secret pattern in 158 blobs; no unreachable objects. Found default credentials printed on the login screen (recorded under R4). Read-only; no code or history changed. |
| 2026-10-27 | P1A cp1 | Channel-by-channel authorization inventory on `security/p1a-identity` (`docs/security/p1a-authz-analysis.md`): 46 channels, 27 admin-guarded, actor argument per call site located, `users:updateStatus`/`users:delete` confirmed to guard the actor rather than the target, login/renderer-storage/logout map, single main window confirmed. Analysis only; no app code changed. |
| 2026-10-27 | P1A cp2 | Added pure `electron/security/session.cjs` and `adminDecision.cjs` with 20 tests. No app behaviour changed yet. |
| 2026-10-27 | P1A cp3 | Q5 wired: session set on login, cleared on `auth:logout` and window close; `isAdmin` requires the session and re-reads `role, status`. R1 and R2 fixed; R18 (reload) and R19 (`backup:restore`) recorded as accepted residual risks rather than changed, per instruction. |
| 2026-10-27 | P1A cp4 | Q6 wired: `electron/security/senderGuard.cjs` plus one guarded `ipcMain.handle` swap in `electron/ipc/index.cjs`. R20 recorded: the packaged route URLs measured in a real window (`file:///D:/`, `file:///D:/students`) do not equal `dist/index.html`, so the URL policy allows one flat segment under a drive root; HashRouter is the fallback if a route URL is ever denied. |
| 2026-10-27 | P1A cp5 | Added `tests/electron/security/ipcGuardWiring.test.ts` (9 tests) pinning the wrapper: every `*.ipc.cjs` is required exactly once by `ipc/index.cjs`, the guard is installed before the first require and restored after the last, no handler is registered outside `electron/ipc`, channel names are unique (47), and `main.cjs` passes the guard. Proven non-vacuous with a planted rogue module and a planted handler outside `electron/ipc`. This register updated: §4/§5 mitigation text, R1/R2 fixed, R3 narrowed, R18–R20 added. |
| 2026-10-27 | P1B cp1 | Window, dev-mode and installer analysis (`docs/security/p1b-window-analysis.md`): one dev decision at `main.cjs:17`, no menu ever set, print window takes the app preload, no pop-up/navigation/webview guards, no permission handlers, renderer needs camera video only, `@electron/fuses` not installed, installer script `npm run build:win`. Analysis only. |
| 2026-10-27 | P1B cp2 | Q1: production means packaged. `electron/security/runtimeMode.cjs` decides dev from `app.isPackaged === false` alone; the dev-server URL and DevTools follow it, so `NODE_ENV=development` can no longer point an installed copy at Vite (R21 fixed). |
| 2026-10-27 | P1B cp3 | Q2: packaged builds get `devTools: false` on both windows, no application menu, and a `before-input-event` guard over F12/F5/Ctrl+R/Ctrl+Shift+I/J (`electron/security/blockedKeys.cjs`). R11 narrowed to CSP. |
| 2026-10-27 | P1B cp4 | Q4: the hidden print window no longer gets the app preload (R12 fixed); it keeps sandbox, `nodeIntegration: false` and `contextIsolation: true`, and its temp page has no script and calls no bridge. |
| 2026-10-27 | P1B cp5 / cp5b | Q7: `electron/security/navGuard.cjs` denies window-open, away-navigation (reusing the Q6 URL policy) and webview attachment, and installs request/check permission handlers that grant camera video only (R22 fixed). cp5b lets the check handler answer Chromium's `mediaType: 'unknown'` label probe; the request handler stays video-only and audio stays denied. |
| 2026-10-27 | P1B cp6 | Q13: `scripts/afterPack.cjs` flips `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments` off in the Windows exe and is registered as `afterPack`; `@electron/fuses@1.8.0` added as the only new package (R23 fixed, pending the installer smoke test). No IPC, schema or CSP change in P1B. |
| 2026-10-27 | P1B cp7 | Q6 follow-up: the packaged renderer loaded a blank content area because BrowserRouter pushes history-API paths onto a `file://` document. `src/App.tsx` now mounts `HashRouter` (route paths unchanged), so the document URL stays `dist/index.html` and only the fragment changes — which `will-navigate` does not see. Tests extended: hashed index URLs allowed by the policy, the sender guard and the navigation gate; every other file and host still denied behind a hash; wiring pinned that the gate is on `will-navigate` only. R20 resolved; no policy rule loosened. |
