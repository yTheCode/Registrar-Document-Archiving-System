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
- **`Native Max` quality option is intermittent and can be an unreachable mode.**
  In `src/utils/cameraCapabilities.ts`, the extra ceiling option is only added when
  `plausibleNative && beatsPresets` passes (64-66), and `plausibleNative` is
  `aspectGap <= 0.3 && areaGap <= 3` (61) — both measured against the *current*
  settings from `track.getSettings()`. So whether the option appears at all depends
  on the mode the camera happens to start in, not on the hardware's real ceiling.
  Worse, `maxWidth`/`maxHeight` are independent per-axis maxima, so they can combine
  into a size no real mode satisfies (e.g. `1280 x 1920` on a camera whose actual
  top mode is `1920 x 1080`); picking it makes the driver refuse
  `applyCameraQuality`, and the user sees the "…is not available on this camera"
  error path. Related: lines 67-69 stamp `[Native Max]` onto `options[0]` even when
  the ceiling option was skipped, so the label and the option are not the same thing.
  Recorded only — behavior depends on the camera's startup mode, and no camera is
  attached here to reproduce it.
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

## 8. Phase 3a — analysis of `src/pages/ImportScanner.tsx` (2,309 lines)

No code edited in 3a. All line numbers are `src/pages/ImportScanner.tsx` on
branch `refactor/phase-3`. Imported directly (not lazy) at src/App.tsx:7 and
routed at src/App.tsx:99 (`/import`, admin-only per the Phase-0 uncertainty note).

Counts (verified by grep on this file): 39 `useState`, 11 `useRef`, 10 `useEffect`,
1 `useMemo`, 46 component-level functions/helpers (incl. `newTempId` and the
`renderStudentSearch` JSX factory), plus `showError` from `useToast` (57).
JSX is lines 1324-2305 (~980 lines).

### 8.1 Logical sections

| # | Section | Lines (logic) | Lines (JSX) |
| --- | --- | --- | --- |
| S1 | Admin gate + page shell (header, message banner, workflow banner) | 37-52, 268-269 | 1324-1395 |
| S2 | Workflow / step state machine | 54-55, 845-861, 1200-1210, 257-266 | 1398-1476 |
| S3 | Reference data loading (document types, students) | 114-115, 139-156 | — |
| S4 | Student search + Add New Student modal | 116, 119-127, 160-254, 1196-1198 | 1243-1321, 2119-2270 |
| S5 | Batch (session) student pick / change | 63, 1213-1241 | 1369-1395, 1479-1491 |
| S6 | Deferred confirmation dialog | 60, 807-815, 1228-1241 | 2272-2285 |
| S7 | Import queue (`filesWithMetadata`) + selection + review paging | 66-68, 97-98, 272-307, 348-384, 817-843, 895-918 | 1494-1536, 1745-1835, 1711-1737 |
| S8 | Per-document metadata form + live sync back into the queue | 129-133, 281, 309-346, 865-893, 920-930 | 1838-2103 |
| S9 | Camera device + stream + quality | 80-96, 388-582, 586-594, 796-805 | 1553-1625 |
| S10 | jscanify live detection / auto-crop overlay | 101-112, 571-582, 597-703 | 1627-1680 |
| S11 | Capture intake (add / retake) + finish/cancel | 69, 71, 711-793 | 1682-1706 |
| S12 | Image editor modal + "Edit All Images" sequence | 70-78, 932-1037 | 2108-2116 |
| S13 | Batch save / archive + results + saving overlay | 135-137, 1039-1194 | 2040-2102, 2288-2304 |

### 8.2 State inventory, grouped by section

**S1/S2 — shell + step machine**
- `useState`: `workflow` (54), `step` (55), `message {type,text}` (56)
- `useRef`: none
- `useEffect`: `beforeunload` guard (257-266) → deps `[filesWithMetadata.length, step]`
- derived: `isStudentWorkflow` (268), `isScanWorkflow` (269), `WORKFLOW_LABELS` (28-33, module const)

**S3 — reference data**
- `useState`: `documentTypes` (114), `students` (115)
- `useEffect`: mount loader (139-142, `[]`) → `loadDocumentTypes` (144-149), `loadStudents` (151-156)

**S4 — student search + add student**
- `useState`: `searchTerm` (116), `showAddStudentForm` (120), `newStudentForm` (121), `pendingForceAdd` (124), `addStudentMessage` (125), `isAddingStudent` (126)
- `useRef`: `pendingStudentPickRef` (119) — callback resumed after creation
- derived: `filteredStudents` (1196-1198)

**S5 — batch student**
- `useState`: `batchStudent` (63)

**S6 — confirm dialog**
- `useState`: `confirmDialog` (60) — `{title, message, confirmLabel, danger?, action}`

**S7 — queue**
- `useState`: `filesWithMetadata` (66), `currentFileIndex` (67), `reviewPage` (68)
- `useRef`: `nextTempIdRef` (97) + `newTempId()` (98)
- `useEffect`: review-page sync on index change (272-274)
- derived: `reviewTotalPages`/`reviewStart`/`reviewSlice` (276-278), `currentFile` (280), `readyCount` (298), `editableImageCount` (307)

**S8 — metadata form**
- `useState`: `currentStudent` (129), `currentDocType` (130), `currentAcademicYear` (131), `currentRemarks` (132), `currentDynamic` (133)
- `useMemo`: `debouncedUpdate` (309-316, `debounce(…, 300)` keyed on `currentFileIndex`)
- `useEffect`: cancel debounce on change (318-322); live-sync write-back (327-346, 12 deps, `JSON.stringify` diff on `dynamicMetadata`)
- derived: `studentRequiredForCurrent` (281, literal `true` — see 8.5)

**S9 — camera**
- `useState`: `cameraStream` (80), `cameraError` (84), `videoDevices` (85), `deviceId` (86), `qualityOptions` (87), `selectedQuality` (88), `activeResolution` (91)
- `useRef`: `cameraStreamRef` (83), `videoRef` (92), `cameraActiveRef` (93), `qualityPrefRef` (96)
- `useEffect`: device enumeration + `devicechange` when `step==='camera'` (586-594); unmount teardown (796-805)

**S10 — detection / auto-crop**
- `useState`: `scannerState` (101), `documentFound` (102), `edgesUncertain` (105), `autoCropEnabled` (108)
- `useRef`: `overlayCanvasRef` (109), `analysisCanvasRef` (110), `detectionBusyRef` (111)
- `useEffect`: `initScanner()` when camera step opens (597-614); detection interval (617-621); overlay clear when auto-crop turned off (624-631)

**S11 — capture intake**
- `useState`: `capturedImage` (69), `retakeIndex` (71)

**S12 — image editing**
- `useState`: `showImageEditor` (70), `editAllImagesMode` (76)
- `useRef`: `editorTargetRef` (74), `editQueueRef` (77)

**S13 — save**
- `useState`: `isProcessing` (135), `isSaving` (136), `batchResults` (137)

### 8.3 Handlers and the data each touches

| Handler | Lines | Reads | Writes |
| --- | --- | --- | --- |
| `handleStartWorkflow` | 1200 | `wf` | workflow, batchStudent, files, index, step |
| `resetAll` | 845 | — | camera (via stopCamera), step, workflow, files, index, all 5 `current*`, batchResults, batchStudent, searchTerm, editQueue, editAllImagesMode |
| `handlePickCurrentStudent` | 160 | `s` | currentStudent, searchTerm |
| `openAddStudentForm` | 165 | `searchTerm` | pendingStudentPickRef, newStudentForm, addStudentMessage, showAddStudentForm |
| `closeAddStudentForm` | 182 | — | pendingStudentPickRef, showAddStudentForm, addStudentMessage, pendingForceAdd |
| `handleCreateStudent` | 189 | newStudentForm, pendingForceAdd, `user.id`, electronAPI create/getStudentById/addLog | students, searchTerm, all form/flags, then resumes `pendingStudentPickRef` callback |
| `handleFileSelect` | 348 | electronAPI openFileDialog, isStudentWorkflow, batchStudent | files (append), index, all `current*`, searchTerm, step |
| `handleJumpToFile` / `handleNextFile` / `handlePreviousFile` | 913 / 895 / 904 | files, index, `current*` | via `persistCurrentFileMetadata` + `loadFileMetadata` + index |
| `persistCurrentFileMetadata` | 865 | files, index, batchStudent, currentStudent, `current*` | files (returns updated array synchronously) |
| `loadFileMetadata` | 886 | file, batchStudent, isStudentWorkflow | all `current*`, searchTerm |
| `handleCopyFromPrevious` | 920 | files, index | currentDocType/Year/Remarks/Dynamic, currentStudent, message (+3s clear) |
| `handleDeleteCapture` → `executeDeleteCapture` | 807 / 817 | files, index, retakeIndex | confirmDialog → files, retakeIndex, camera+step when empty |
| `handleRetakeCapture` | 828 | index, deviceId | retakeIndex, step, camera |
| `handleEditCapture` | 834 | files, isEditableImage | message; delegates to `openImageInEditor` |
| `handleStartScan` | 506 | deviceId | cameraError, retakeIndex, step, camera |
| `handleCancelCamera` | 788 | — | camera, retakeIndex, step, cameraError |
| `handleFinishScanning` | 771 | files, batchStudent, isStudentWorkflow | camera, retakeIndex, index, all `current*`, searchTerm, step |
| `handleCapturePhoto` | 711 | `videoRef`, retakeIndex, files, batchStudent, isStudentWorkflow | files (append or replace), retakeIndex, documentFound, edgesUncertain, message |
| `handleSwitchCamera` | 535 | newDeviceId | qualityPrefRef, qualityOptions, selectedQuality, deviceId, camera |
| `handleQualityChange` | 546 | qualityOptions, cameraStream | selectedQuality, qualityPrefRef, cameraError, activeResolution, message (+3.5s) |
| `handleToggleAutoCrop` | 571 | autoCropEnabled | autoCropEnabled, message (no timer) |
| `openImageInEditor` | 976 | file, electronAPI readPickedFileAsBase64 | editorTargetRef, capturedImage, showImageEditor |
| `handleEditAllImages` | 1000 | files, isEditableImage | editAllImagesMode, editQueueRef, editor (via openImageInEditor), message |
| `handleImageEdit` | 932 | editorTargetRef, editAllImagesMode, editQueueRef, files | files (`editedDataUrl`+`thumbnail`), editor state, message |
| `handleImageEditCancel` | 1023 | editAllImagesMode | editorTargetRef, editAllImagesMode, editQueueRef, editor state, message |
| `handleSubmit` | 1039 | finalized queue, documentTypes, `user.id`, electronAPI getSetting/generateFolderPath/saveBase64Image/copyFile/createDocumentsBatch, useToast showError | isProcessing, isSaving, message, batchResults, then `resetAll` after 3 s when clean |

### 8.4 Pure logic (no React needed)

- `WORKFLOW_LABELS` (28-33)
- `validateDocument` (285-295) + `isFileReady` (297) — needs `documentTypes` as an argument
- `isEditableImage` (301-306)
- `newTempId` counter (97-98)
- review pagination math (276-278)
- student search filter (1196-1198)
- `looksLikeId` prefill heuristic (166-168) + empty `newStudentForm` shape (121/170-177)
- camera `Error.name` → friendly text mapping (490-500)
- `drawLiveOutline` (633-667) — canvas math + strokes; only needs `(overlayCanvas, videoDims, quad, analysisWidth)`
- per-file archive loop in `handleSubmit` (1079-1138) and batch-row shape (1122-1132) — async electronAPI calls, no state
- the "set message, auto-clear after N ms" idiom — **8 sites** (568, 839, 929, 960, 967, 1008, 1031, 1219) → DRY candidate
- the `FileWithMetadata` literal shape — **3 sites** (357-369 disk, 745-756 capture, 735-742 retake patch) → DRY candidate
- `success`/`error` unwrap shape used by every electronAPI call here matches the `{ success, error, … }` contract (hard rule 8)

### 8.5 Suspected bugs / dead code found (recorded only — NOT fixed)

- `studentRequiredForCurrent` is a hardcoded `true` (281), which makes the
  "Not Student-Specific" branch (1984-1991) unreachable dead JSX. The comment
  at 281 says all documents now require a student.
- `loadDocumentTypes` (144) and `loadStudents` (151) ignore `result.success ===
  false` silently (no console, no toast) — violates the "never swallow errors"
  convention; kept verbatim.
- `beforeunload` guard (257-266) only warns when `step !== 'details'`, so an
  unsaved batch sitting on the tagging screen is lost without warning.
- On `createDocumentsBatch` failure (1143) the files already copied into the
  archive are not rolled back — orphaned files on disk with no DB rows.
- `handleImageEdit` (947-953) reads `filesWithMetadata` from the closure made
  when `handleEditAllImages` opened the editor; during a long Edit-All pass the
  array can be stale for anything except the `editedDataUrl` write. Indices stay
  valid because nothing reorders the queue mid-sequence.
- `resetAll` (845) does not clear `deviceId`, `videoDevices`, `qualityOptions`,
  `qualityPrefRef` or `autoCropEnabled`, so a Start Over keeps the last camera
  and quality choice. Probably intended; recorded.
- The 3-second post-save `setTimeout` (1178) can fire after the user navigates
  away, calling `resetAll`/`setIsSaving` on an unmounted component.
- The live-detection interval effect (617-621) omits `runLiveDetection` from its
  deps (intentional — it only reads refs). Any future ESLint enablement (Phase
  6-lite) will flag this and the 12-dep live-sync effect (327-346).
- Two parallel notification channels (`message` banner + `useToast().showError`)
  coexist; save failures use the toast, capture feedback uses the banner.

### 8.6 Proposed `src/features/import-scanner/` layout

The page implementation moves into the feature folder; `src/App.tsx` keeps its
current `import ImportScanner from './pages/ImportScanner'` (src/App.tsx:7) and
its `/import` route (src/App.tsx:99) untouched — that file becomes the re-export
shim described in §9 #1. The component keeps the `PageProps` signature.

```
src/features/import-scanner/
  components/
    ImportScannerPage.tsx        ~180  composition only: gate, banners, step switch, modals
    AccessRestricted.tsx         ~20   S1 guard card (37-52)
    WorkflowPicker.tsx           ~85   S2 four mode buttons (1398-1476)
    WorkflowBanner.tsx           ~60   S1/S5 indicator + locked-student summary (1343-1395)
    StepFileAcquisition.tsx      ~50   S2 'files' screen (1494-1536)
    SessionStudentPicker.tsx     ~85   S4 renderStudentSearch, verbatim (1243-1321)
    DocumentStudentField.tsx     ~95   S4 details-step search block (1901-1993)
    AddStudentModal.tsx          ~155  S4 modal (2119-2270)
    CameraPanel.tsx              ~120  S9 controls row (1553-1625)
    CameraPreview.tsx            ~65   S10 video + overlay + status pill (1627-1680)
    CaptureActions.tsx           ~55   S11 capture/finish/cancel + hint (1682-1706)
    ScannedQueue.tsx             ~35   S7 thumbnail cards (1711-1737)
    ReviewTable.tsx              ~100  S7 table + Pagination (1745-1835)
    DocumentNavCard.tsx          ~65   S8 current-file + prev/next (1838-1895)
    DocumentDetailsForm.tsx      ~120  S8 student/type/year/remarks (1897-2037)
    BatchResultsList.tsx         ~28   S13 results (2040-2060)
    ImportActionBar.tsx          ~48   S13 copy/cancel/submit (2063-2102)
    ImageEditorModal.tsx         ~20   S12 wrapper (2108-2116)
    SavingOverlay.tsx            ~22   S13 overlay (2288-2304)
  hooks/
    useReferenceData.ts          ~45   S3 documentTypes/students + loaders
    useAddStudent.ts             ~110  S4 form/flags + create + resume callback
    useConfirmDialog.ts          ~30   S6 open/resolve
    useImportQueue.ts            ~150  S7 files/index/review + add/append/patch/delete/jump
    useDocumentMetadata.ts       ~110  S8 current* + debounced live-sync + persist/load/copy
    useCamera.ts                 ~190  S9 stream, devices, quality, start/stop/switch
    useLiveDetection.ts          ~150  S10 scannerState, quad overlay, auto-crop flag
    useCaptureIntake.ts          ~90   S11 capture/retake/finish/cancel
    useImageEditing.ts           ~130  S12 editor + Edit-All queue
    useImportSubmit.ts           ~140  S13 validation + archive loop + results
  lib/
    workflowLabels.ts            WORKFLOW_LABELS + isStudent/isScan predicates
    documentValidation.ts        validateDocument, isFileReady
    editableImages.ts            isEditableImage, editableIndices
    queueHelpers.ts              tempId counter, FileWithMetadata builders (3 call shapes), pagination math
    studentSearch.ts             filterStudents(students, term), looksLikeId prefill
    cameraErrors.ts              Error.name → friendly message
    liveOutline.ts               drawLiveOutline(overlay, videoDims, quad, analysisWidth)
    archiveBatch.ts              per-file generateFolderPath + save/copy loop → results
    transientMessage.ts          CLEANUP-COMMIT ONLY (see §9 #4) — not part of the moves
```

State that stays in `ImportScannerPage.tsx` (per §9): `message`, `searchTerm`,
`step`, `workflow`. Everything else moves behind a hook.

`src/pages/ImportScanner.tsx` becomes a one-line re-export of
`@/features/import-scanner/components/ImportScannerPage`. src/App.tsx is NOT
edited and the old page file is NOT deleted (owner decision, §9 #1).

### 8.7 Questions raised in 3a (answered — see §9)

1. Re-export shim vs repointing src/App.tsx:7.
2. The two student-search UIs (1243-1321 and 1901-1993) are near-duplicates but
   differ in class names, result cap (8 vs 5), input height (`h-10` vs `h-9`)
   and placeholder. Hard rule 2 forbids changing class names, and rule 7 needs
   3+ occurrences → dedupe or not.
3. `message` banner state is read by 5 sections — who owns it.
4. `resetAll` spans 11 setters across 6 hooks, and `stopCamera` must run first
   (side-effect order) → thin page-level `handleResetAll` calling each hook's
   `reset*()` in the current order.
5. `useCaptureIntake` needs `videoRef` from `useCamera` plus queue + retake
   state — the tightest coupling in the file.
6. `handleSubmit` depends on queue, validation, `documentTypes`, `user.id` and
   `handleJumpToFile` → `useImportSubmit({ queue, metadata, documentTypes, userId, showError, onSaved })`.
7. Step ordering, leaf → root, one commit each, typecheck + build per step
   (kept as the plan, now 3b-1 … 3b-10, since App.tsx is no longer repointed).

## 9. Phase 3a decisions (approved by owner, 2026-10-25)

1. **Page wiring:** keep `src/pages/ImportScanner.tsx` as a **one-line
   re-export** of the new `ImportScannerPage`. Do **not** edit src/App.tsx and
   do **not** delete the old page file. Retargeting App.tsx and dropping the
   shim happens *after* the defense pass.
2. **`message` banner state:** stays in the page verbatim. Feature hooks receive
   `setMessage` as an argument; the banner component receives `message` as a
   prop. Any effect or callback that depends on `setMessage` must use the raw
   setter or a `useCallback` wrapper so its identity stays stable.
   **No `useMessage` hook.** Auto-dismiss timers stay with the page state.
3. **Student search:** two separate components copied verbatim, named for where
   they are used (`SessionStudentPicker`, `DocumentStudentField`). No
   parameterizing, no merging. Differences recorded under "Dedupe later" below.
4. **Transient-message DRY:** because `setMessage` lives in the page and the 8
   `setTimeout` clears sit inside handlers, the verbatim move keeps each
   handler's own timer. `lib/transientMessage.ts` is a **cleanup-commit** item
   only (rule 4/7), and must land as a plain helper, not a hook.

### Dedupe later — the two student-search blocks

Both read `searchTerm`, `filteredStudents`, `currentStudent`, and both call
`setSearchTerm('')` on pick/clear and `openAddStudentForm(...)` on the empty
state. Differences to reconcile in a later commit:

| Aspect | `renderStudentSearch` 1243-1321 → `SessionStudentPicker` | details-step block 1901-1993 → `DocumentStudentField` |
| --- | --- | --- |
| Call sites | one (line 1489, `selectStudent` step) | one (line 1903, inside `!isStudentWorkflow && studentRequiredForCurrent`) |
| Pick callback | `onPick` parameter — call site passes `handlePickBatchStudent`; item click runs `onPick(student)` then `setSearchTerm('')` | inline `setCurrentStudent(student)` then `setSearchTerm('')` |
| Add-student target | `openAddStudentForm(onPick)` (forwards the same callback) | `openAddStudentForm(handlePickCurrentStudent)` |
| Field label | none | `label-caps` "Student" + red `*` |
| Outer wrapper | `div` (no class) | `div` (no class), label as first child |
| Badge container | `mb-3 flex items-center gap-2 … px-4 py-2.5` | `flex items-center gap-2 … px-3 py-2.5` (no `mb-3`, `px-3`) |
| Badge name | `text-sm font-bold text-[#182a43] truncate` | `text-xs font-bold text-[#182a43] truncate` |
| Input row wrapper | `relative mb-3` | `relative mb-2` |
| Input | `h-10`, `text-sm`, placeholder "Search by name, school year, or student ID…", **`autoFocus`** | `h-9`, `text-xs`, placeholder "Search students…", **no `autoFocus`** |
| Results container | `max-h-64 overflow-y-auto …` | `max-h-48 overflow-y-auto …` |
| Result cap | `filteredStudents.slice(0, 8)` | `filteredStudents.slice(0, 5)` |
| Result name row | `text-sm font-bold text-[#263950]` | `text-xs font-bold text-[#263950]` |
| Result button / mono row classes | identical (`w-full px-3 py-2 text-left hover:bg-[#f8fafc] border-b border-[#edf0f3] last:border-0`, `mono mt-0.5 text-[10px] text-[#8995a4]`) | identical |
| Clear-selection button | identical classes and identical `onClick` (`setCurrentStudent(null)`, `setSearchTerm('')`) | identical |
| Empty state text | `No students found for "{searchTerm}"` | same |
| Add New Student button classes | `mt-2 inline-flex … text-xs font-bold text-[#24558d] …` | same |
| Quirk to preserve | the selected-student badge renders from **`currentStudent`**, not `batchStudent`, even on the `selectStudent` step (the two are synced by `handlePickBatchStudent` at 1221-1222) | renders from `currentStudent` |

No merge is possible without a `size`/`autoFocus`/`maxResults`/`label` prop set;
that is a behavior-neutral cleanup for a dedicated commit.

*(Phase 3a complete: no source edits. Awaiting owner approval before 3b-1.)*

## 10. Phase 3b execution log

### 3b-0 — page moved, shim recreated (approved 3a)

`git mv src/pages/ImportScanner.tsx` →
`src/features/import-scanner/components/ImportScannerPage.tsx`, byte-for-byte
(staged blob `3812953…` == HEAD blob of the old path). `src/pages/ImportScanner.tsx`
is now the one-line re-export
`export { default } from '@/features/import-scanner/components/ImportScannerPage'`.
The internal function is still named `ImportScanner` (no rename) and src/App.tsx is
untouched. No import paths needed fixing — the page already imports everything
through the `@/` alias.

**Finding — build artifacts are not a clean neutrality signal while this file
exists.** Tailwind v4 (`@import 'tailwindcss'`, no `@source` narrowing) auto-detects
every git-tracked file, **including REFACTOR_NOTES.md**, so the class-name literals
in §9's dedupe table generate real utility rules: the CSS grew 47.18 kB → 47.46 kB
and the JS hash changed even though no source changed. Verified by building with
this file moved aside: the output is then byte-identical to the Phase-0 baseline
(`index-Dqg5fwYU.css`, `index-XYgmIFkO.js`) *with* the page already moved.
Consequences for every later checkpoint:
- Compare typecheck/build **PASS/FAIL**, not hashes; or rebuild with the notes
  moved aside when a hash delta needs explaining.
- The extra CSS is unused rules only — no visual change. Logged as a Phase 6-lite
  candidate (add `@source` narrowing or ignore `*.md`); NOT fixed here (rule 1).

Working-tree note: `core.autocrlf=true`, so checked-out sources are CRLF (verified
against `src/pages/Settings.tsx`); git normalizes them to LF in the index. Nothing
was mass-reformatted.

### 3b-1 — `lib/` pure logic (approved 3a)

Created under `src/features/import-scanner/lib/` (111 lines total, bodies moved
verbatim): `workflowLabels.ts` (WORKFLOW_LABELS), `documentValidation.ts`
(validateDocument + isFileReady, now taking `documentTypes` as a 2nd argument
because the closure was page state), `editableImages.ts` (isEditableImage),
`queueHelpers.ts` (getReviewWindow — the three review-pagination lines),
`studentSearch.ts` (filterStudents, studentIdFromSearchTerm), `cameraErrors.ts`
(describeCameraError — the `error.name` mapping), `liveOutline.ts`
(drawLiveOutline, refs replaced by `overlay`/`video` parameters).
Page: 15 insertions / 92 deletions, 10 call sites rewired; now 2,232 lines.
Verified: typecheck PASS, build PASS, CSS hash unchanged from 3b-0
(`index-BVwFChkt`) so no class delta; JS +0.12 kB from the new module wrappers.

**Trap handled:** `validateDocument`/`isFileReady` gained a second parameter, so
`filesWithMetadata.filter(isFileReady)` would have passed the array **index** as
`documentTypes`. It is now `.filter(f => isFileReady(f, documentTypes))`.
`filter(isEditableImage)` stays as-is — its signature is still single-argument.

**Deviations from §9's layout (all to avoid dead abstraction or state moving):**
- `isStudentWorkflow`/`isScanWorkflow` were NOT put in `workflowLabels.ts`. They
  are page-derived values read at 16 sites; extracting them as pure predicates
  would leave either two unused exports or 16 mechanical rewrites. They will be
  passed as props to the components that need them (3b-2+).
- `queueHelpers.ts` holds only the pagination math. The `nextTempIdRef` counter
  stays in the page (it is state, §9 #2) and the three `FileWithMetadata` object
  literals stay at their sites — each currently has a single call site, so
  building a shared factory is the DRY pass, which comes after the moves (rule 4
  and rule 7), not during them.
- `editableIndices` was not extracted: one 3-line site inside
  `handleEditAllImages`.

### Feature port — auto-crop on capture

**auto-crop on capture (`04cba01`) was merged from main and ported into
`ImportScannerPage.tsx`; it is a deliberate behavior change outside the refactor.**
The merge (`cea6d22`) landed `04cba01`'s edit on `src/pages/ImportScanner.tsx`, which
on this branch is the one-line re-export shim, so the feature code had to be replayed
onto the real page. Method: `git show 04cba01` piped through a `sed` path rewrite, then
`git apply` — the patch applied with only line offsets (−75/−77), and the resulting
change set was diffed against the original hunk-by-hunk to confirm it is byte-identical
(38 insertions / 11 deletions on both sides). src/pages/ImportScanner.tsx stays the
one-line shim. The Global "behavior must not change" rule is therefore lifted for
`handleCapturePhoto` and its two strings ONLY — everything else on this branch is still
a pure refactor.

### 3b-2 — display components (approved 3a)

Ten presentational components created under `src/features/import-scanner/components/`,
bodies copied verbatim with a uniform dedent (no rewritten markup, no class change):
`AccessRestricted` (admin guard), `WorkflowBanner` (indicator + locked-student summary),
`WorkflowPicker` (four mode buttons), `StepFileAcquisition` ('files' screen),
`ScannedQueue` (thumbnail cards), `ReviewTable` (table + Pagination),
`BatchResultsList` (results), `ImportActionBar` (copy/cancel/submit),
`ImageEditorModal` (wrapper), `SavingOverlay`.
Page: 2,259 → 1,932 lines (595 insertions / 390 deletions).

Kept exactly as before: **no state or effect moved** (§9), no ref passed as a prop, no
`React.memo`/`useCallback`/`useMemo` added, element order and conditional rendering
unchanged. The `step === 'mode'`, `step === 'files'`, `filesWithMetadata.length > 0`,
`batchResults.length > 0`, `showImageEditor && capturedImage` and `isSaving` guards stay
written at the page's call sites; only `WorkflowBanner` carries its two guards inside,
because they are what makes the pair appear and it needs `step` for them
(`workflow && step !== 'mode'`, `isStudentWorkflow && batchStudent && step !== 'selectStudent'`).
Page imports dropped after the move: `Upload`, `Users`, `CheckCircle2`, `Crop` (lucide),
`Pagination`, `ImageEditor`, `WORKFLOW_LABELS` — `noUnusedLocals` proves they are gone.
`PAGINATION`, `validateDocument`, `FileText`, `User`, `AlertCircle`, `formatStudentYear`
and `cn` are still used by the sections that remain (camera = 3b-5, per-file tagging and
details form = 3b-4, student pickers + Add-student modal = 3b-3).

Inside the moved bodies the only edits are handler→prop renames required by §9's
explicit-props rule: `handleStartWorkflow`→`onStartWorkflow`, `resetAll`→`onResetAll`,
`handleChangeStudent`→`onChangeStudent`, `handleStartScan`→`onStartScan`,
`handleFileSelect`→`onFileSelect`, `handleEditCapture`/`handleRetakeCapture`/
`handleDeleteCapture`→`on*Capture`, `handleJumpToFile`→`onJumpToFile`,
`handleEditAllImages`→`onEditAllImages`, `setReviewPage`→`onReviewPageChange`,
`handleCopyFromPrevious`→`onCopyFromPrevious`, `handleImageEdit`/`handleImageEditCancel`→
`onSave`/`onCancel`. `ReviewTable` receives `reviewSlice` + `reviewStart`, which the page
still computes through `getReviewWindow` (the pagination state stays in the page).

**Trap caught by typecheck:** `ImportActionBar`'s Cancel button also called the page's
`resetAll`, which §8.6's block list did not mention — `Cannot find name 'resetAll'` at
ImportActionBar.tsx:26. It is now an `onResetAll` prop wired to the same `resetAll`.

Verified: typecheck PASS, build PASS, CSS hash unchanged from 3b-1 (`index-BVwFChkt.css`,
47.46 kB) so no class delta; JS 407.34 → 408.90 kB (+1.56 kB = ten module wrappers plus
the prop plumbing).

### 3b-3 — student search components + add-student modal (approved 3a)

Created `SessionStudentPicker.tsx` (97 lines), `DocumentStudentField.tsx` (113) and
`AddStudentModal.tsx` (180). Page: 1,932 → 1,643 lines (34 insertions / 323 deletions).
`SessionStudentPicker` is the page's old `renderStudentSearch` closure — its `onPick`
parameter kept the same name, so that body moved with **zero** rewrites and the call
site simply passes `onPick={handlePickBatchStudent}`.

**§9 #3 honoured:** the two searches were NOT merged. Asserted after the move — the
picker still has `autoFocus`, `h-10`, `text-sm`, `slice(0, 8)`, `max-h-64` and no field
label; the field still has `h-9`, `text-xs`, `slice(0, 5)`, `max-h-48` and the
required-star label and still no `autoFocus`. Differences remain listed for the
after-the-defense merge.

**Nothing became page-less state:** `searchTerm`, `currentStudent`, `showAddStudentForm`,
`newStudentForm`, `pendingForceAdd`, `addStudentMessage`, `isAddingStudent`,
`currentDocType`, `studentRequiredForCurrent` and the `filterStudents` call all stay in
the page; components only receive them. Props that carry page state or its setters keep
their exact page names so the moved JSX stays byte-identical; only page callbacks became
`on*` props (`handlePickCurrentStudent`→`onPickCurrentStudent`,
`handleCreateStudent`→`onCreate`, `closeAddStudentForm`→`onClose`).
`DocumentStudentField` wraps the moved `{studentRequiredForCurrent ? … : currentDocType && …}`
expression in a fragment so it moves verbatim; the `<>…</>` the page had around that one
expression was dropped, which renders the same DOM.

Page imports freed by the move: `User`, `Search as SearchIcon`, `X`, `UserPlus`
(`noUnusedLocals` confirms none of them is still referenced).

**Traps caught:** my first extraction range for the modal ran one line too far and ate
its closing `)}` (TS1128 at AddStudentModal.tsx:178) — rebuilt from `git show HEAD:…`
with the correct 1759–1908 range; the same range also swallowed the blank line before
`{confirmDialog && (}`, restored in the page.

Verified: typecheck PASS, build PASS, CSS hash unchanged (`index-BVwFChkt.css`, 47.46 kB)
so no class delta; JS 408.90 → 410.16 kB (+1.26 kB = three module wrappers plus props).
Still in the page: the camera section (3b-5) and DocumentNavCard + DocumentDetailsForm
(3b-4).

## After the defense

Follow-ups deliberately deferred until the defense pass is finished.

1. **Merge the two student-search components** (`SessionStudentPicker` and
   `DocumentStudentField`) into one parameterized component. They are near-duplicates
   moved verbatim in 3b-3; the full list of differences to reconcile — props, pick
   handlers, result caps (8 vs 5), input size (`h-10`/`text-sm` vs `h-9`/`text-xs`),
   `autoFocus`, `max-h-64` vs `max-h-48`, the required-star label, and the
   `currentStudent` badge quirk — is recorded under "Dedupe later" in §9.
2. **`buildStudentSearchFilter` — already in the right place, nothing to move.**
   It lives at `electron/services/studentQueries.cjs:11`, is exported at line 76, and is
   the sole import of `electron/ipc/documents.ipc.cjs:7`; `electron/services/authz.cjs`
   exports only `isAdmin`. The stale claim that it sits in `authz.cjs` comes from the
   §7 Phase-1b layout table ("`services/authz.cjs` isAdmin, buildStudentSearchFilter")
   and from the §1/§2 dependency maps drawn in Phase 1a, before the split was executed.
   Correcting §7 is a documentation fix, not a code move.
3. **Align the remaining 1600-pixel detection with the live outline.**
   `src/components/ImageEditor.tsx:187` (`runDetection`) still analyses at
   `SCANNER_CONFIG.CAPTURE_ANALYSIS_MAX_SIDE` (1600) while the live outline runs at
   `LIVE_ANALYSIS_MAX_SIDE` (640), so opening Edit on a capture can propose different
   corners than the overlay just showed — the detector's luminance sampling bands and
   blur/close kernels are all sized relative to the analysis pixels. Capture-time
   detection was aligned to 640 in this commit; the editor is the same problem and is
   NOT touched here (it is outside the one-change scope and is used by manual Edit too).
   Also worth evaluating: instead of re-running the detector at capture, reuse the quad
   the live loop already computed — but note it is a local `const quad` in
   `runLiveDetection` (line 611) that is drawn and then discarded, so reuse means
   keeping it in a ref first, and scaling it from the 640-pixel analysis box to the
   full-resolution capture canvas. Needs a check that that scale factor is exact for
   letterboxed previews before it replaces the second detection.
