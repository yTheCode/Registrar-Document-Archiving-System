# P1D CP3 — statements for the SRS and the slides

The SRS and the slides live outside this repository, so this file is the source to copy from.
Every number below was measured on branch `security/p1d-docs-and-verify` (base `origin/main` =
`b6ea594`) with the commands named in §6, not recalled from older documents. Where an old
statement is wrong, the replacement is written as a ready-to-paste sentence.

## 1. The numbers to use

| Fact | Value | Where it comes from |
| --- | --- | --- |
| IPC channels (`ipcMain.handle`) | **47** | 47 sites, 47 unique names, 14 `*.ipc.cjs` modules |
| `window.electronAPI` methods | **47** | `electron/preload.js`, one per channel |
| Admin-guarded channels | **27** | `isAdmin(...)` call sites |
| Session-only channels | **2** (`auth:login`, `auth:logout`) | `electron/ipc/auth.ipc.cjs` |
| Channels that need no login | **18** | register §5 / R3 |
| Test files / tests | **28 / 304**, all passing | `npm test` |
| Lint | **0 errors, 112 warnings** | `npm run lint` |
| Renderer | React **18.3.1** + TypeScript **5.9.3** (strict), Vite **5.4.21** | installed tree |
| Router | `HashRouter` (react-router-dom **6.30.6**) | `src/App.tsx:2-4` |
| Desktop shell | Electron **28.3.3** (declared `^28.1.0`) | installed tree |
| Database driver / file | better-sqlite3 **9.6.0**, one SQLite file | `package.json`, `electron/db/connection.cjs` |
| SQLite journal mode | **default rollback journal (`delete`)** — no `journal_mode` pragma is executed | `grep -rn "journal_mode\|pragma" electron/` |
| Password hashing | bcryptjs **2.4.3**, cost factor **10** | `electron/db/connection.cjs` |
| Default archive root | `%APPDATA%\adzu-registrar-archive\Archive` | `electron/paths.cjs` (`DEFAULT_ARCHIVE_ROOT`) |
| Packaging | NSIS installer, electron-builder **24.13.3**, `build/icon.ico`, `afterPack` fuse flip | `package.json` |

## 2. Ready-to-paste corrected statements

**UI technology.** The user interface is a **React 18 single-page application written in
TypeScript (strict mode)**, bundled by Vite and styled with Tailwind CSS. It is not plain
HTML/CSS/JavaScript; the only hand-written HTML file is the Vite entry point `index.html`.

**Data access.** There is **no Repository layer**: no `StudentRepository`, `DocumentRepository`
or Repository-pattern interface exists. SQL runs in the Electron main process, inside the IPC
handlers, through `getDb().prepare(...)`; the only extracted query code is the pure SQL-builder
module `electron/services/studentQueries.cjs` (whitelisted sort columns, parameterised values).

**IPC surface.** The renderer can reach exactly **47 channels**, each with one
`window.electronAPI` method: **27** are admin-guarded, **2** are session endpoints
(`auth:login`, `auth:logout`), and **18** (student reads, document search, settings read,
dashboard stats, folder-path generation, image save, `file:copy`, `file:openExternal`,
`file:showInFolder`, `file:readAsBase64`, `file:readPickedAsBase64`, `file:print`, and the two
dialogs) still require **no login**.

**Authorization.** Every admin-guarded handler runs `isAdmin(userId)`, and it passes only when
`userId` is the account that logged in — the main process stores the session at `auth:login`
and clears it on `auth:logout` or window close — and that account's row is re-read as
`role = 'admin'` **and** `status = 'active'`. A renderer-supplied id for another account is
rejected. Separately, every one of the 47 channels first checks that the call comes from the
main window's main frame on the app's own page.

**Session.** Login is remembered in two places: `sessionStorage` in the renderer and the
main-process session. There is no idle timeout; closing the window or logging out clears both.
A renderer reload clears only `sessionStorage`, so the UI returns to the login screen while the
main process still holds the previous session (documented residual risk, register R18).

**Password change.** **No password-change feature exists.** `users:create` sets the password of
a new account; `users:updateStatus` only activates or deactivates; there is no channel, screen or
self-service change for an existing account.

**Storage.** The database is a single SQLite file opened by better-sqlite3 in SQLite's
**default rollback-journal (`delete`) mode** — WAL is not enabled — and `backup:create` uses
SQLite's online backup API. The database and the archived files are **plaintext on disk**:
protection is the Windows user account plus (for the disk) BitLocker, which the team enables by
hand on each installed copy.

**Archive location.** There is one default root, `%APPDATA%\adzu-registrar-archive\Archive`
(`userData\Archive`), and one resolver used by imports, opens, folder naming, backups and
restores. The stored `archive_directory` setting wins when it has content; a missing or blank
row is repaired to the default. Only Settings → Archive Location writes it; `settings:set`
refuses that key.

**Router.** The renderer uses **`HashRouter`**, because the packaged app is loaded from a
`file://` document and history-API paths would not resolve there; routes are unchanged and
client-side. Route guards are a convenience — the main process re-validates every privileged call.

**Process hardening.** Production mode is decided by `app.isPackaged` alone, so an environment
variable cannot point an installed copy at the dev server. A packaged build has no DevTools, no
application menu and no DevTools/reload shortcuts; the window denies pop-ups, away-navigation and
`<webview>` attachment; only camera **video** is granted; the hidden print window has no preload;
and the Windows exe ships with `RunAsNode`, `NODE_OPTIONS` and `--inspect` fuses off.

**Date display.** `formatDate` and `formatTimestamp` return `Unknown date` / `Unknown time` for a
missing or unparseable value instead of throwing, so one bad stored date can no longer blank a
whole list.

## 3. What Phase 1 protects against (use in the defence)

| Q | Protection now in the code |
| --- | --- |
| Q1 | An installed copy cannot be switched to the Vite dev server with `NODE_ENV=development` |
| Q2 | A packaged build has no DevTools, no menu, no reload/DevTools shortcuts |
| Q3 | `file:copy` accepts only files the user picked in the Open dialog |
| Q4 | The hidden print window no longer carries the app preload (47 methods) |
| Q5 | Admin checks require the main-process session and a live, active admin row |
| Q6 | IPC calls from any other frame, window or page return `Permission denied` |
| Q7 | Pop-ups, away-navigation, `<webview>` and every permission except camera video are denied |
| Q10 | README/HANDOFF claims match the build; a corrections record is in `docs/security/` |
| Q11 | One archive root and one resolver — imports and backups can no longer disagree |
| Q12 | A bad date renders a placeholder instead of blanking a list |
| Q13 | The exe cannot be turned into a Node shell or have code injected via `NODE_OPTIONS`/`--inspect` |

## 4. What Phase 1 does **not** protect against (state these as limitations)

- **18 channels still need no login.** `students:getAll/search/getById/getFilterOptions`,
  `documents:search`, `documentTypes:getAll`, `settings:get`, `dashboard:getStats`,
  `folders:generatePath`, `image:saveBase64`, `file:copy`, `file:openExternal`,
  `file:showInFolder`, `file:readAsBase64`, `file:readPickedAsBase64`, `file:print` and the two
  dialogs (register R3).
- **Default accounts and passwords are still seeded** (`admin` / `admin123`, `user` / `user123`)
  and are printed on the login screen and in the README (R4 and Q8). **Q8 is handled by hand:
  change both passwords on every installed copy**; this phase did not touch them.
- **No login throttling or lockout**, and the bcrypt compare is synchronous (R5).
- **Path containment is string-based** (`path.resolve` + `path.relative`): a junction, symlink,
  UNC path, trailing-dot or 8.3 name is not normalised (R7).
- **No extension allowlist** on open/print/export, so a stored `.exe`/`.lnk` would be handed to
  the OS (R8); **no size or type limits** on base64 IPC (R9).
- **The audit log can still be forged by the renderer**: `logs:add` is admin-guarded but its
  action text and target are renderer-supplied (R10).
- **Backup restore still trusts the archive path stored inside the backup's database** (R14,
  needs a hostile-ZIP check).
- **`logs:add` aside, no CSP is set**; `sandbox` stays implicit (Electron 28 default on).
- **Electron 28.3.3 is out of support** and 27 npm advisories are unresolved; the only two that
  reach an installed copy are Electron itself and the router (register §7, R15).
- **The database, the archive and the backup ZIP are plaintext.** Data at rest depends on
  BitLocker/OS permissions (R16, Q9 — **enable BitLocker on the drive that holds the database and
  the archive**, handled by hand, not by this phase).
- **A renderer reload keeps the main-process session** (R18), and a restore swaps the users table
  under a live session (R19); both are accepted risks.

## 5. One README item not corrected (not in the approved list)

README §3 is titled "Verified package versions (from `package.json`)" but prints the caret
minimums, not what is installed: React 18.2 vs **18.3.1**, TypeScript 5.3 vs **5.9.3**,
Tailwind 4.0-beta vs **4.3.3**, React Router 6.21 vs **6.30.6**, better-sqlite3 9.2 vs **9.6.0**,
Vite 5.0 vs **5.4.21**, Electron 28.1 vs **28.3.3**, adm-zip 0.6 vs **0.6.1**, electron-builder
24.9.1 vs **24.13.3**. The numbers in §1 above are the installed ones; if the SRS quotes
versions, quote those. Changing the README table was not in the approved edit list.

## 6. How the numbers were measured

```
grep -rc "ipcMain.handle(" electron/ipc/*.cjs          # 47 sites
grep -rhoE "ipcMain\.handle\('[^']+'" electron/       # 47 unique names
grep -c "ipcRenderer.invoke" electron/preload.js      # 47
npm test                                              # 28 files, 304 tests
npm run lint                                          # 0 errors, 112 warnings
grep -rn "journal_mode\|pragma" electron/             # no journal_mode anywhere
node -e "…require('<pkg>/package.json').version"      # installed versions
```
