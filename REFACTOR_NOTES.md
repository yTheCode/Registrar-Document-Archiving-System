# Refactor Notes

## Baseline

Recorded on branch `refactor/phase-0` (2026-10-25), before any source edit.

- `npm run typecheck` (`tsc --noEmit`) — **PASS** (no errors)
- `npm run build` (`tsc && vite build`) — **PASS**
  - prebuild step `prepare:scanner` ran cleanly (jscanify@1.4.3 assets already current, 2 files skipped)
  - 1924 modules transformed, built in ~4.8s
  - outputs: `dist/assets/index-XYgmIFkO.js` 406.79 kB (gzip 112.57 kB), `dist/assets/index-Dqg5fwYU.css` 47.18 kB (gzip 9.65 kB)
- `node_modules/` was already present and up to date; no fresh `npm install` was needed.

### Known large files (targets for later phases)

| File | Lines |
| --- | --- |
| electron/main.cjs | ~2838 |
| src/pages/ImportScanner.tsx | ~2309 |
| src/pages/Settings.tsx | ~1155 |
| src/pages/Students.tsx | ~1111 |
| src/pages/Search.tsx | ~712 |
| src/components/ImageEditor.tsx | ~628 |
| src/components/DocumentViewerModal.tsx | ~613 |

## Uncertainties

- Route guard nuance: `/import`, `/settings` and `/logs` routes only exist for `role === 'admin'`
  (src/App.tsx:97); non-admin users hitting those URLs land on the catch-all `Navigate to="/"`.
  Anything moved must preserve this conditional-route behavior exactly.
- Auth session lives in `sessionStorage` under key `user` (src/App.tsx:31); not a bug fix in scope,
  but refactor steps must not touch the storage key or the login/logout flow shape.
- `electron/main.cjs` is plain CommonJS and must stay that way; the same file mixes DB access,
  IPC handlers and file/archive logic — the safe split points need to be identified per phase
  without changing IPC channel names or `window.electronAPI` signatures (defined in `electron/preload.js`).
- Some utils in `src/utils/` are only consumed by one page (e.g. `jscanifyScanner.ts`,
  `cameraCapabilities.ts`); whether they migrate into a feature folder or stay shared is a
  Phase-planning decision — flagged here so it is not decided silently mid-move.
- Working-tree cleanliness at session start was unknown ("Git content filters are configured");
  baseline was captured from a clean HEAD commit `985caa3` on `main`.

## Suspected bugs

Per hard rule 1 these are recorded only — NOT fixed during the refactor.

- **Fallback archive-root inconsistency.** `getArchiveRoot()` (1996) and the 3
  inlined reads fall back to `path.join(app.getPath('documents'), 'ADZU_Archive')`,
  but `resolveArchiveDir()` (2541) and `initializeDatabase()` (389) fall back to
  `path.join(userDataPath, 'Archive')`. If the `archive_directory` setting is ever
  missing, backup reads and runtime reads point at *different* folders.
- **`PROGRAM_FOLDERS` duplicated as a literal.** Line 2117 defines the map; inside
  `archive:purgeAll`, line 1822 hardcodes `['College Student Records', 'Graduate
  Student Records', 'Medical Student Records', 'Law Student Records', 'General
  Documents']`. Any future change to the map silently misses the purge cleanup list.
- **Unauthenticated handlers.** `auth:login`, `students:getAll/search/getById/
  getFilterOptions`, `documents:search`, `documentTypes:getAll`, `settings:get`,
  `dashboard:getStats`, `folders:generatePath`, `image:saveBase64`, `file:copy` and
  the `file:open*/read*/show*` family have no `isAdmin` check (and no session check
  at all — the renderer is trusted). Possibly intentional for a single-seat desktop
  app; flagging, not changing.
- `users:getAll` counts the *whole* `users` table for `total` but the proposed
  layout keeps it as-is; no bug, just noting the count ignores any future filter.
- (other findings will be appended as phases progress)

## Phase 1a — dependency map for `electron/main.cjs` (2,838 lines, 46 IPC handlers)

All line numbers refer to `electron/main.cjs` on `refactor/phase-1` HEAD.

### 1. Module-level state

| Item | Lines | Kind | Written by | Read by |
| --- | --- | --- | --- | --- |
| `mainWindow` | 7 | `let`, reassigned | `createWindow()` (405) | `dialog:openFile` (1711), `dialog:openDirectory` (1721) — both pass it as dialog parent |
| `db` | 8 | `let`, **reassigned at runtime** | `initializeDatabase()` (267), `closeDatabase()` sets `null` (455), `backup:restore` closes/reopens **twice** (2743-2756 success path, 2800-2818 recovery path) | every function and handler below |
| `sessionPickedFiles` | 1371 | `const Set` (mutated, never reassigned) | `dialog:openFile` (1715) | `file:readPickedAsBase64` (1393) |
| `userDataPath`, `dbDir`, `dbPath`, `legacyDbPath` | 11-17 | `const`, with **import-time side effects**: `mkdirSync(dbDir)` (13-15) and legacy DB copy (18-21) | — | `initializeDatabase`, `isForbiddenPickedPath`, `isSafeArchiveTarget`, backup handlers |
| `STUDENTS_TABLE_SCHEMA` | 220 | const | — | `runMigrations` only (96, 209) |
| `PROGRAM_FOLDERS` | 2117 | const map | — | `computeDocumentTypeFolder` (2163), `migrateDocumentTypeFolders` (2273), `documents:update` (1043), **hardcoded `folderList` copy** (2454) |
| `STUDENT_SORT_COLUMNS` | 543 | const | — | `buildStudentPage` |
| `USER_SORT_COLUMNS`, `LOG_SORT_COLUMNS`, documents `sortColumns` | 1560, 1912, 1166 | consts **inline inside handlers** | — | their own handler only |

Key point: `db` is reassigned, so consumers cannot capture a value at require time.
`db/connection.cjs` must expose `getDb()`; services that need to *replace* it
(`backup:restore`) need `setDb()` / `reconnectDatabase()` rather than a
`new Database()` in-file — otherwise the closure over the old handle silently
survives a restore. This is a behavior-preserving constraint on the split.

Also: `userDataPath` / `dbDir` / `dbPath` are computed at module load, before any
function is defined. Their initialization order must stay ahead of
`ipcMain.handle` registration in the refactored `main.cjs`.

### 2. Function call graph — helpers shared across several handlers

| Function | Lines | Callers | Handlers reached |
| --- | --- | --- | --- |
| `isAdmin(userId)` | 480 | **~27 handlers** (all admin-guarded ones) | authz |
| `getArchiveRoot()` | 1996 | `resolveArchivePath` (2006), `toArchiveRelative` (2019), `removeEmptyDirectoriesRecursive` (1876), `computeDocumentTypeFolder` (2142), `archive:changeDirectory` (2416), `archive:purgeAll` (1757) | archive, files, documents, folders |
| `resolveArchivePath(stored)` | 2004 | `documents:purge` (981), `documents:update` (1075), `file:openExternal` (1293), `file:showInFolder` (1313), `file:readAsBase64` (1333), `file:print` (1430), `file:exportCopy` (1518), `archive:purgeAll` (1804), `archive:checkIntegrity` (2505), `migrateDocumentTypeFolders` (2283) | documents, files, archive, migrations |
| `toArchiveRelative(abs)` | 2018 | `documents:update` (1097), `documents:createBatch` (2080), `migrateDocumentTypeFolders` (2307), `migrateToRelativePaths` (2334) | documents, migrations |
| `validateAndResolvePath(p, root)` | 1976 | `file:copy` (1270), `image:saveBase64` (2032) | files, images |
| `registerDbFunctions(handle)` | 253 | `initializeDatabase` (268), `backup:restore` (2755, 2815) | db, backup |
| `buildStudentSearchFilter(term, alias)` | 493 | `buildStudentListWhere` (574), `documents:search` (1129 with alias `'s'`) | students, documents |
| `buildStudentListWhere(opts, term)` | 569 | `students:getAll` (593), `students:search` (605) | students |
| `buildStudentPage(opts)` | 551 | `students:getAll` (595), `students:search` (607) | students |
| `sanitizeFolderName` | 2124 | `buildStudentFolderName` (2134), `computeDocumentTypeFolder` (2143), `migrateDocumentTypeFolders` (2281) | folders |
| `sanitizeWindowsFileName` | 2202 | `buildStudentDocumentFileName` (2198) | folders |
| `buildStudentFolderName` | 2128 | `computeDocumentTypeFolder` (2169), `migrateDocumentTypeFolders` (2280) | folders |
| `buildStudentDocumentFileName` | 2181 | `folders:generatePath` (2390) | folders |
| `pickCollisionFreeFileName` | 2234 | `documents:update` (1089), `folders:generatePath` (2357) | documents, folders |
| `computeDocumentTypeFolder({…})` | 2141 | `documents:update` (1080), `folders:generatePath` (2349) | documents, folders |
| `removeEmptyDirectoriesRecursive` | 1857 | `archive:purgeAll` (1827) — recursive self-call | archive |
| `isSafeArchiveTarget(dir)` | 2527 | `archive:changeDirectory` (2421), `backup:restore` (2729) | archive, backup |
| `isForbiddenPickedPath(resolved)` | 1373 | `file:readPickedAsBase64` (1393) | files |
| `resolveArchiveDir(handle)` | 2541 | `inspectBackupDatabase` (2565), `backup:create` (2609) | backup |
| `removeDatabaseSidecars` | 2575 | `backup:restore` (2748, 2810) | backup |
| `runMigrations()` | 24 | `initializeDatabase` (384), **`backup:restore` (2760, 2817)** | db, backup |
| `rebuildTable` | 232 | `runMigrations` (96, 209) only | db |
| `migrateDocumentTypeFolders` | 2252 | `initializeDatabase` (397) only | startup |
| `migrateToRelativePaths` | 2328 | `initializeDatabase` (400) only | startup |

### 3. Self-contained handlers (no shared helper beyond `db` + `isAdmin`)

`auth:login` (509), `students:getById` (632), `students:create` (641),
`students:update` (720), `students:delete` (775), `students:getDeleted` (803),
`students:restore` (824), `students:purge` (840), `students:getFilterOptions` (618),
`documents:delete` (857), `documents:getDeleted` (890), `documents:restore` (938),
`documentTypes:getAll/create/delete` (1209/1218/1237), `users:*` (1552-1678),
`settings:get/set` (1679/1688), `logs:add/getRecent` (1885/1902),
`dashboard:getStats` (1936), `file:readAsBase64`/`readPickedAsBase64`/`print`/`exportCopy`,
`dialog:openFile`/`openDirectory` (1711/1721), `archive:checkIntegrity` (2495),
`image:saveBase64` (2025), `file:copy` (1263), `folders:generatePath` (2347).

`file:print` (1421) is the only handler that creates a second `BrowserWindow`
(hidden print window) and lazily requires `electron.shell` + `url`.
`backup:create` lazily requires `archiver` (2613); `backup:restore` lazily requires
`adm-zip` (2699). Those lazy `require()` calls must stay lazy — moving them to the
top of a new file changes load-time behavior.

### 4. Repeated 3+ times → DRY candidates (Phase 2+, only *after* moves)

- `if (!await isAdmin(userId)) return { success:false, error:'Permission denied. Admin access required.' }` — ~27 sites.
- `INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?,?,?,?,?)` — 15 explicit sites, plus 6 more with the 4-col variant (no `target_id`).
- The `archive_directory` read is **inlined in 3 handlers instead of calling `getArchiveRoot()`**
  (`file:copy` 1266, `image:saveBase64` 2028, `migrateDocumentTypeFolders` 2254).
  Behaviorally identical to `getArchiveRoot()`; keep the inline copies during the
  verbatim move, dedupe later.
- Path validation preamble (`resolve → null check → existsSync check`) in 5
  `file:*` handlers.
- The `{ success:false, error: error.message }` try/catch wrapper in all 46 handlers.

### 5. Target layout — confirmed with two adjustments

The proposed layout matches the dependency map above. Two corrections:

1. **`db/migrations.cjs` needs `db/connection.cjs`, not the reverse.**
   `runMigrations`/`rebuildTable` must read the live handle via `getDb()`
   (they are called again from `backup:restore` after the handle is replaced).
   Also move `STUDENTS_TABLE_SCHEMA` there (only `runMigrations` uses it).
2. **Add `services/archiveIntegrity.cjs`** for `removeEmptyDirectoriesRecursive`
   (called only by `archive:purgeAll`, but it uses `getArchiveRoot()`, so it is not
   dialog-local) — or keep it inside `ipc/archive.ipc.cjs`. Decision needed: it is
   26 lines and single-caller, so keeping it local to `archive.ipc.cjs` is the
   smaller surface. Recommendation: **local to `ipc/archive.ipc.cjs`**.
3. `isSafeArchiveTarget` is used by `archive:changeDirectory` *and* `backup:restore`,
   so it belongs in `services/backup.cjs` as proposed and `ipc/archive.ipc.cjs`
   must import it from there (cross-service dependency, no cycle).
4. `PROGRAM_FOLDERS` (line 2117) is read by `computeDocumentTypeFolder`,
   `migrateDocumentTypeFolders` and `documents:update`, **and duplicated as a
   hardcoded `programFolders` array at line 1822** inside `archive:purgeAll`.
   It belongs in `services/folderNaming.cjs` as a single exported map; the
   duplicate literal at 1822 is logged under Suspected bugs and stays verbatim
   in its own move until Phase 2 dedupe.
5. `ipc/index.cjs` must register in the **current file order**
   (auth → students → documents → documentTypes → files → users → settings →
   dialogs → archive purge → logs → dashboard → images → batch/folders → archive
   location → backup), because `ipcMain.handle` registration order is observable
   if a duplicate channel were ever introduced (there are none today — all 46 names
   are unique).

### 6. Open questions before Phase 1b

*(All resolved — see "Phase 1a decisions" below.)*

- Where do the DB-backed settings live? `getArchiveRoot()` reads `settings` via
  `db`; `services/archivePaths.cjs` will therefore depend on `db/connection.cjs`.
  Confirm that is acceptable versus passing a getter in.
- `documents:createBatch` (2058) sits under the `ipc/documents.ipc.cjs` group in
  the proposal; its section header in the file is `BATCH OPERATIONS`. Confirm it
  goes to `documents.ipc.cjs` (recommend: yes).
- `image:saveBase64` is the sole occupant of `images.ipc.cjs` (~30 lines). Confirm.
- Startup path: `initializeDatabase()` currently calls `migrateDocumentTypeFolders()`
  and `migrateToRelativePaths()` at the end (397, 400). If those move to
  `services/archiveMigrations.cjs`, they must be called from
  `db/connection.cjs`'s `initializeDatabase()` to keep the exact same startup
  sequence — confirm we keep them inside `initializeDatabase()` rather than
  surfacing them to `main.cjs`.
- **Circular-import risk with that choice.** `db/connection.cjs` (→
  `initializeDatabase`) would require `services/archiveMigrations.cjs`, which
  requires `services/archivePaths.cjs`, which requires `db/connection.cjs` for
  `getDb()`. CJS tolerates this cycle only because the calls happen after
  exports are complete, not at require time. Safer alternative: keep the
  migration *functions* in `services/archiveMigrations.cjs` and invoke them
  from `main.cjs` right after `initializeDatabase()` inside the existing
  try/catch — same observable order, no cycle. Recommend: **invoke from
  `main.cjs`** and note it here as the one deliberate placement change.

## Phase 1a decisions (approved by owner, 2026-10-25)

1. `services/archivePaths.cjs` may depend on `db/connection.cjs` via `getDb()`.
   **RULE: never call `getDb()` at module top level** (no `const db = getDb()`
   at require time). Call it inside functions, at use time.
2. `documents:createBatch` → `ipc/documents.ipc.cjs`.
3. `image:saveBase64` alone in `ipc/images.ipc.cjs`.
4. Startup migrations: `migrateDocumentTypeFolders()` and `migrateToRelativePaths()`
   are invoked from `main.cjs`, inside the existing `app.whenReady()` try block,
   right after `initializeDatabase()` and before `createWindow()`. Both functions
   keep their internal try/catch, so error behavior is unchanged.
5. `removeEmptyDirectoriesRecursive` stays local to `ipc/archive.ipc.cjs`.
6. ONE `ipc/archive.ipc.cjs` holds `purgeAll`, `changeDirectory`, `checkIntegrity`.
   All 46 channel names are unique, so registration order does not matter.

### Additions (from owner)

A. **`__dirname` breaks when code moves into subfolders.** Created
   `electron/paths.cjs`, placed DIRECTLY in `electron/`, exporting:
   `userDataPath`, `dbDir`, `dbPath`, `legacyDbPath`, `ELECTRON_DIR`
   (= `__dirname`), `PROJECT_ROOT` (= `path.join(__dirname, '..')`),
   `PRELOAD_PATH`. Import-time side effects (mkdir of `dbDir`, legacy DB copy)
   live in that file; it is required first in `main.cjs`. The four `__dirname`
   uses replaced: line 17 (legacyDbPath), line 1374 (forbidden picked path →
   `ELECTRON_DIR`), line 1476 (print-window preload → `PRELOAD_PATH`), line
   2536 (forbidden archive target → `PROJECT_ROOT`). Lines 414, 417 and 425
   stay in `main.cjs` unchanged.
B. **`mainWindow`** moves to `electron/window.cjs` with `getMainWindow()` /
   `setMainWindow()`. `dialogs.ipc.cjs` calls `getMainWindow()` at call time,
   never captures it.
C. **`db`**: `connection.cjs` exports `getDb()` and `setDb(handle)`. In
   `backup:restore` keep the existing `new Database(...)` lines verbatim and call
   `setDb()` with the new handle. **No `reconnectDatabase()` abstraction.** The
   close → sidecar removal → copy → open → `registerDbFunctions` →
   `runMigrations` sequence must stay in exactly that order on BOTH the success
   and the recovery path.
D. **`services/pickedFiles.cjs` exports the SAME Set instance** — never reassign it.
E. **Lazy `require()` calls stay lazy**: `archiver`, `adm-zip`,
   `require('electron').shell`, `url`.

Suspected bugs: all left logged and unfixed (hard rule 1).

### Verification protocol after EACH step

`npm run typecheck`, `npm run build`, `npm run dev` (app must launch, no
main-process errors), and at the end of Phase 1: `ipcMain.handle(` count still
46 with no duplicate channel names.

## 7. Phase 1b — executed split (refactor/phase-1)

Commits: `026c7ad` (step 1 paths/window), `f35150a` (step 2 db/),
`4750df9` (step 3 services/), `e13ce21` (step 4 ipc/ + index.cjs).

Final layout (all moves verbatim; only module preludes and `__dirname`
anchors adapted):

```
electron/main.cjs              80 lines  lifecycle + createWindow only
electron/paths.cjs                      dbDir paths, legacy copy side effects
electron/window.cjs                     getMainWindow / setMainWindow
electron/db/connection.cjs              getDb / setDb / initialize / close
electron/db/migrations.cjs              runMigrations + table schemas
electron/services/authz.cjs             isAdmin, buildStudentSearchFilter
electron/services/studentQueries.cjs
electron/services/archivePaths.cjs      getArchiveRoot, resolveArchivePath...
electron/services/folderNaming.cjs      PROGRAM_FOLDERS, computeDocumentTypeFolder...
electron/services/archiveMigrations.cjs startup folder/relative-path migrations
electron/services/backup.cjs
electron/services/pickedFiles.cjs       shared Set instance (never reassigned)
electron/ipc/*.ipc.cjs (14 modules) + index.cjs (registerAllIpc)
```

Handler count: 46 across the 14 ipc modules, no duplicate channel names, 0 in
main.cjs. Verified per step: typecheck, build, `npm run dev` launch with
"Database initialized" and no main-process errors.

**Rule-10 overrun:** `electron/ipc/documents.ipc.cjs` is 418 lines (>300) —
the seven `documents:*` handlers plus `createBatch` as one verbatim region.
`files.ipc.cjs` (299) and `archive.ipc.cjs` (291) are at the limit. Splitting
documents.ipc.cjs further would need a non-verbatim re-cut; deferred as a
Phase-2 cleanup candidate together with the section-4 DRY items.
