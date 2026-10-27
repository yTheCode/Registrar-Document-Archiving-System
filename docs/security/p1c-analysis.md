# Phase 1C — picked-file copy and one archive root (CP1 analysis)

Analysis only. No application file was changed in this checkpoint.

| Item | Value |
| --- | --- |
| Branch | `security/p1c-files-and-paths` (from `origin/main`, commit `1d65ace`) |
| Date | 2026-10-27 |
| Method | Read `electron/ipc/{files,images,dialogs,settings,folders,backup,archive}.ipc.cjs`, `electron/services/{pickedFiles,archivePaths,backup,archiveMigrations,folderNaming}.cjs`, `electron/db/connection.cjs`, `electron/paths.cjs`, `electron/preload.js`, `src/features/import-scanner/components/ImportScannerPage.tsx`, `src/pages/Settings.tsx`; `git grep` for `copyFile`, `saveBase64`, `openFileDialog`, `readPickedFileAsBase64`, `type="file"`, `onDrop`/`dataTransfer`, `archive_directory`, `ADZU_Archive`, `'Archive'`, `getArchiveRoot`, `resolveArchiveDir`. Line numbers are for `1d65ace`. |

---

## 1. Q3 — how the picked-file set works today

### 1.1 Who fills `sessionPickedFiles`

| Item | Location | Behaviour |
| --- | --- | --- |
| The set | `electron/services/pickedFiles.cjs:3` | module-level `new Set()`, never reassigned, exported as a live object |
| Only writer | `electron/ipc/dialogs.ipc.cjs:9-17` (`dialog:openFile`) | after the OS dialog returns, adds `path.resolve(picked)` for every entry in `result.filePaths` |
| `dialog:openDirectory` | `electron/ipc/dialogs.ipc.cjs:19-26` | adds **nothing** |
| Clearing | nowhere | the set lives for the whole main-process session; only a process restart empties it |

Current consumers:

| Consumer | Location | Check today |
| --- | --- | --- |
| `file:readPickedAsBase64` | `electron/ipc/files.ipc.cjs:140-171` | `path.resolve(filePath)`, then `isForbiddenPickedPath(resolved)` (`:127-138`, blocks `dbDir`, `dbPath`, `ELECTRON_DIR`, the OS system folder) **and** `sessionPickedFiles.has(resolved)` (`:147`) — exact string membership |
| `file:copy` | `electron/ipc/files.ipc.cjs:17-41` | **no source check at all**; only the *destination* is confined (`validateAndResolvePath(destPath, archiveRoot)`, `:24`) and then `fs.copyFileSync(sourcePath, …)` (`:32`) |

### 1.2 Normalization today

Only `path.resolve()` — twice, on both sides (`dialogs.ipc.cjs:13`, `files.ipc.cjs:145`). That turns a relative path into an absolute one against the main process cwd and normalizes separators and `.`/`..`, but:

- no case folding, so `C:\Users\X\a.JPG` and `c:\users\x\a.jpg` are different set members;
- no `\\?\` / long-path or UNC normalization, so `\\?\C:\…` and `\\server\share\…` stay distinct strings;
- the lookup is `Set.has`, i.e. exact string equality on the resolved value.

In practice the dialog hands back the path the user chose and the renderer echoes it verbatim, so an exact match works for the normal flow — but it is string equality, not a path-identity rule.

### 1.3 Every renderer call site of `file:copy`

There is exactly **one**, plus the preload wrapper:

| # | Call site | Source of `sourcePath` | Reached when |
| --- | --- | --- | --- |
| 1 | `src/features/import-scanner/components/ImportScannerPage.tsx:1068` — `copyFile(fileData.filePath, destPath)` | `fileData.filePath` on a queued `FileWithMetadata` row | inside the save loop, only in the `else` branch of `if (fileData.editedDataUrl \|\| fileData.isDataUrl)` (`:1064`) |
| — | `electron/preload.js:44` | — | `ipcRenderer.invoke('file:copy', { sourcePath, destPath })` |

Types only: `src/types/electron.d.ts:134`.

Where `filePath` on a queued row comes from — exhaustive:

| Row origin | Location | `filePath` value | Takes the copy path? |
| --- | --- | --- | --- |
| Disk import via the Open dialog | `ImportScannerPage.tsx:323-358`; the value stored at `:337` is the raw string from `openFileDialog` | an absolute Windows path the user picked; `dialog:openFile` already added its `path.resolve` to the set | **yes** — this is the only row type that reaches `copyFile` |
| Camera capture / retake | `ImportScannerPage.tsx` `handleCapturePhoto` (`:640`), rows built at `:684` (retake) and `:694` (new) | `imageDataUrl` (a `data:image/jpeg;base64,…` string) with `isDataUrl: true` | no — `:1064` sends it to `saveBase64Image` |
| Image edited in `ImageEditor` | `ImportScannerPage.tsx:886-896` | `editedDataUrl` is set; `filePath` is left untouched so Reset All still works | no — `editedDataUrl` sends it to `saveBase64Image` |

No other producer exists:

- no drag-and-drop: `git grep` finds no `onDrop`, `dragover`, `dragenter`, `dataTransfer` or `DataTransfer` in `src/`;
- no hidden `<input type="file">`: no `type="file"` in `src/`;
- no "re-import a document from the archive" feature: `filePath` is only ever assigned at `:337`, `:684` and `:694`, and `readPickedFileAsBase64` (the archive-free reader) is called from one place, `:938`, to preview/edit a **picked** file;
- `folderResult.destPath` is a destination, never a source.

**Conclusion for Q3:** no caller supplies a source path that did not come from the Open dialog, so the STOP condition in the phase prompt is not triggered. CP2 can add the membership check to `file:copy` without breaking the import flow.

Two residual notes to keep in mind for CP2:

1. The set is session-wide: a file picked once stays copyable until the app restarts. That matches the Q3 wording ("did not pick in the Open dialog"), and it is the same lifetime `file:readPickedAsBase64` already relies on.
2. If the check is made case-insensitive for `file:copy` only, `file:readPickedAsBase64` stays exact-match. That is fail-closed (it can only reject more), and it is what the phase prompt asks for; it will be stated in the commit and notes rather than silently unified.

## 2. Q11 — every place that computes the archive root

### 2.1 The six named in the phase prompt — all confirmed

| # | Location | Key line | Value when the setting is missing/empty | Trims? | Creates the folder? |
| --- | --- | --- | --- | --- | --- |
| 1 | `electron/db/connection.cjs:160-168` (`initializeDatabase`) | `:161` read, `:163` `path.join(userDataPath, 'Archive')`, `:167` insert | `userData\Archive` — but only when the row is **missing** (`if (!archiveDir)`, `:162`); an empty row is kept | no | yes, only for the default (`:164-166`) |
| 2 | `electron/services/backup.cjs:25-28` (`resolveArchiveDir(handle)`) | `:27` `path.join(userDataPath, 'Archive')` | `userData\Archive` | no | no |
| 3 | `electron/services/archivePaths.cjs:28-31` (`getArchiveRoot()`) | `:30` `path.join(app.getPath('documents'), 'ADZU_Archive')` | `Documents\ADZU_Archive` | no | no |
| 4 | `electron/ipc/files.ipc.cjs:19-21` (`file:copy`) | `:21` same literal | `Documents\ADZU_Archive` | no | destination only (`:27-30`), after validation |
| 5 | `electron/ipc/images.ipc.cjs:13-15` (`image:saveBase64`) | `:15` same literal | `Documents\ADZU_Archive` | no | destination only (`:22-25`) |
| 6 | `electron/services/archiveMigrations.cjs:16-17` (`migrateDocumentTypeFolders`) | `:17` same literal | `Documents\ADZU_Archive` | no | no |

All six read the row with the same one-line `SELECT value FROM settings WHERE key = 'archive_directory'`, none trims, and they disagree on the default: **2 values, 4 copies of the `Documents` one and 2 of the `userData` one.**

### 2.2 Other places found (not in the prompt's list of six)

| # | Location | What it does | In scope for CP3? |
| --- | --- | --- | --- |
| 7 | `electron/services/archivePaths.cjs:12` (`validateAndResolvePath`) | falls back to `path.resolve(archiveRoot \|\| app.getPath('documents'))` — a **third** value, plain `Documents`, not `Documents\ADZU_Archive` | only reachable if a caller passes a falsy root; after CP3 the two callers (`file:copy`, `image:saveBase64`) always pass a non-empty root. Left as-is, reported. |
| 8 | `electron/services/folderNaming.cjs:36` (`computeDocumentTypeFolder`) | `const root = archiveRoot \|\| getArchiveRoot()` — a renderer-supplied root wins over the setting | no change in CP3; it already delegates to `getArchiveRoot()` when not given one |
| 9 | `src/features/import-scanner/components/ImportScannerPage.tsx:1027-1028` | reads the setting for display/use and falls back to the **relative** string `'Archive'`, then passes it as `archiveRoot` to `generateFolderPath` (`:1046-1052`) | see §2.5 — proposal only |
| 10 | `src/pages/Settings.tsx:83-85` | reads the setting to show the current folder | read-only, no change |
| 11 | `electron/ipc/archive.ipc.cjs:187` (`archive:changeDirectory`) | `oldRoot = path.resolve(getArchiveRoot())` — already the shared function | no change; the writer at `:246-251` stays the only supported way to move the root |
| 12 | `electron/ipc/settings.ipc.cjs:16-30` (`settings:set`) | generic `INSERT … ON CONFLICT` for **any** key, so `archive_directory` can be written with no validation, no folder check and no `archive_directory_changed` audit entry | approved exception: CP3 refuses this key |
| 13 | `electron/ipc/backup.ipc.cjs:41` | `resolveArchiveDir(getDb())` for `backup:create` | covered by fixing `resolveArchiveDir` |
| 14 | `electron/services/backup.cjs:49` (+ `backup.ipc.cjs:157`) | `resolveArchiveDir(probe)` on the **backup's own** database, to learn where that backup expects its archive | must keep reading the backup DB's setting; CP3 only changes the fallback |
| 15 | `electron/ipc/backup.ipc.cjs:151` | `path.join(tempExtractPath, 'Archive')` | **not** a root: it is the fixed entry name the ZIP is written with (`:73`, `archive.directory(archiveDir, 'Archive')`). No change. |

### 2.3 What happens today with a missing or empty setting

Because the four `Documents\ADZU_Archive` copies and the two `userData\Archive` copies disagree, the app splits in two:

| Operation | Root used | Code |
| --- | --- | --- |
| Save an import (copy or base64) | `Documents\ADZU_Archive` | `files.ipc.cjs:21`, `images.ipc.cjs:15` |
| Renderer's `generateFolderPath` call | whatever `getSetting` returned, or the relative `'Archive'` | `ImportScannerPage.tsx:1027-1028`, `folders.ipc.cjs:11-13` |
| Open / print / export / integrity check / purge | `Documents\ADZU_Archive` | `archivePaths.cjs:30` via `resolveArchivePath` |
| Startup folder migration | `Documents\ADZU_Archive` | `archiveMigrations.cjs:17` |
| **Backup create** | `userData\Archive` | `backup.cjs:27` |
| **Backup restore target** | `userData\Archive` (from the backup's DB if it has a row) | `backup.cjs:49` |

So with the row missing or empty, documents are written to `Documents\ADZU_Archive`, while `backup:create` looks in `userData\Archive`, does not find it, and returns `success: true` with the warning `"Archive folder not found … this backup contains the database only."` (`backup.ipc.cjs:42, 95-97`). The backup silently has no documents. A restore then replaces `userData\Archive` (or creates it), while the reappearing database has no row, so the next save goes back to `Documents\ADZU_Archive` — the two folders can never converge.

Empty versus whitespace:

- `''` is falsy, so every `||` fallback fires → the split above.
- `'   '` is **truthy**, so every consumer treats it as a real root: `path.resolve('   ')` is the main-process cwd (plus a space-named segment), so writes are rejected by containment (`validateAndResolvePath`) and a backup looks for a folder under the cwd. No trimming exists today.

Only `settings:set` can produce an empty row today (`settings.ipc.cjs:16-30` accepts any value, including `''`). `initializeDatabase` never rewrites an existing row, empty or not.

### 2.4 Which existing installs a new default could affect

The change CP3 makes is: **one default (`userData\Archive`), applied when the row is missing or blank, and written back to the database so every consumer agrees from then on.**

| Install | Today's root | After CP3 | Affected? |
| --- | --- | --- | --- |
| Fresh install | `userData\Archive` (row written at first init, `connection.cjs:160-168`) | same | no |
| Normal install with a non-empty row (the expected case) | the stored value, everywhere except the *fallback* branches | same — every consumer reads the stored value, trimmed | no |
| Row missing/blank **and** an archive already exists under `Documents\ADZU_Archive` | files written to `Documents\ADZU_Archive`, backups read `userData\Archive` | default written → `userData\Archive`; existing files are **not** moved (no migration, per your instruction) | **yes** — see below |
| Row missing/blank and no archive data yet | n/a | `userData\Archive` | no |

For the affected group the consequences are:

- new scans / imports go to `userData\Archive`;
- rows whose `file_path` is **legacy absolute** (`C:\Users\…\Documents\ADZU_Archive\…`) are now **outside** the root, so `resolveArchivePath` returns `null` and open/print/export/integrity report "File path is outside archive directory" for them (`archivePaths.cjs:36-45`);
- rows whose `file_path` is **relative** (the current format) resolve under the new root and report "File not found";
- nothing is deleted, and the Settings page shows the new root, so the situation is visible; the fix would be `archive:changeDirectory` → *point* at `Documents\ADZU_Archive`, which is an existing, approved, non-destructive operation.

How likely is that group? `initializeDatabase` has inserted the row on every startup since the current code existed, so a missing row implies a database older than that or a hand-edited/restored one. It cannot be determined from this clone which real installations are in it — the way to find out is the Settings page's archive path plus `archive:checkIntegrity` on each machine. The phase prompt accepts this trade-off (no migration), so CP3 will document the group in the register rather than move anything.

One more restore detail that CP3 fixes: today `backup:restore` learns the target from `resolveArchiveDir` on the **backup's** DB, replaces that folder, and leaves the live DB's row as whatever the backup contained. If that row is missing, the restored install immediately diverges again. Calling `ensureArchiveSetting()` after `runMigrations()` writes the same default into the live DB, so the folder that was just replaced is the folder the app will use.

### 2.5 Proposal for place 9 (renderer fallback) — asking, not doing yet

`ImportScannerPage.tsx:1027-1028` currently turns a missing setting into the relative string `'Archive'`. That value is truthy, so `computeDocumentTypeFolder` uses it instead of the main-process root and `mkdir`s a literal `Archive` folder under the Electron cwd; the following `file:copy` then rejects the destination because it is outside the real root. Today this is masked in practice by the row almost always existing, and after CP3 `ensureArchiveSetting` guarantees it — but the fallback is a seventh copy of the archive-root idea and it is wrong on its own.

Smallest fix inside this phase's scope: change `const archiveDir = archiveResult.value || 'Archive'` to pass `archiveResult.value ?? null` (typed `archiveRoot: string` today, so the argument would need `string | null` or an empty string), letting `folders.ipc.cjs` / `folderNaming.cjs` fall back to `getArchiveRoot()` in the main process. That is a renderer + type change outside the six places, so it is **proposed here and not included** in CP3 unless you approve it.

## 3. Plan for the remaining checkpoints

| CP | Work | Files |
| --- | --- | --- |
| CP2 | `electron/security/pickedFiles.cjs` (pure `normalizePickedPath` / `isPickedPath`, `path.win32` semantics injectable, case-folded on Windows) + membership check at the top of `file:copy`; tests for picked / different / case / separator / relative / UNC / empty / null; destination checks untouched | `electron/security/pickedFiles.cjs`, `electron/ipc/files.ipc.cjs`, `tests/electron/security/pickedFiles.test.ts` |
| CP3 | `DEFAULT_ARCHIVE_ROOT` in `paths.cjs`; pure `electron/security/archiveRoot.cjs` `resolveArchiveRoot(settingValue, defaultRoot)`; `getArchiveRoot(handle)` + `ensureArchiveSetting(handle)` in `services/archivePaths.cjs`; all six places switched; `ensureArchiveSetting()` after `runMigrations()` in `backup:restore`; `settings:set` refuses `archive_directory` | `paths.cjs`, `security/archiveRoot.cjs`, `services/{archivePaths,backup,archiveMigrations}.cjs`, `db/connection.cjs`, `ipc/{files,images,settings,backup}.ipc.cjs`, tests |
| CP4 | Same-root proof test (missing setting → save/open/backup/restore agree), register + notes | `tests/`, `REFACTOR_NOTES.md`, `docs/SECURITY_REGISTER.md` |

Known constraint for CP3: `db/connection.cjs` requiring `services/archivePaths.cjs` at load time would create the documented `connection ↔ archivePaths` cycle (the same one recorded in `REFACTOR_NOTES.md` §11.4/Phase 1a question 6), so `initializeDatabase` will require it **inside the function**, at call time, where both modules are fully loaded.
