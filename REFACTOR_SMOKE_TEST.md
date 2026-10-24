# Refactor Smoke Test Checklist

Manual checklist to run against the built app (`npm run dev`, use the Electron window — a plain
browser tab has no `window.electronAPI` and cannot save). Run after each refactor phase; all boxes
must pass before continuing. Use an admin account unless noted.

Legend: each step = Action -> Expected result.

## 1. Login and logout

- [ ] Login with valid admin credentials -> session starts, dashboard renders.
- [ ] Login with wrong password -> error message, no session created.
- [ ] Reload app while logged in (`npm run dev`, sessionStorage cleared on restart) -> back at login screen.
- [ ] Logout -> returns to login screen; navigating back (URL) does not expose data.
- [ ] Login as non-admin user -> routes `/import`, `/settings`, `/logs` are NOT reachable
      (redirect to dashboard); nav items hidden or inactive as designed.

## 2. Students: create / edit / soft-delete / restore / purge

- [ ] Create student (`/students`, `createStudent`) -> appears in list, activity log entry written.
- [ ] Edit student (`updateStudent`) -> changes persist after reload of list.
- [ ] Soft-delete student (`deleteStudent`) -> disappears from active list, appears in student recycle bin (`getDeletedStudents`).
- [ ] Restore student (`restoreStudent`) -> returns to active list, gone from recycle bin.
- [ ] Purge student (`purgeStudent`) -> permanently removed from recycle bin and DB (confirm dialog first).
- [ ] Student list search and filter dropdowns (`getStudentFilterOptions`) -> options populated, filters apply.

## 3. Document import: from file

- [ ] `/import` -> pick a document type and student, choose an existing file (`openFileDialog` ->
      `readPickedFileAsBase64` -> `saveBase64Image` -> `createDocumentsBatch`).
- [ ] File saved under the configured archive directory at the path returned by `generateFolderPath`.
- [ ] Document appears in `/search` with correct type, student, and academic year.
- [ ] Import action recorded in the activity log.

## 4. Document import: from scanner

- [ ] `/import` scanner flow: device appears in camera list (`enumerateDevices` via ImportScanner).
- [ ] Capture a scan (jscanify/OpenCV via `public/scanner/` assets) -> preview renders.
- [ ] Save the scan -> document created in DB and file copied to archive directory.
- [ ] If no camera available: friendly error/capability message (`cameraCapabilities.ts`), no crash.

## 5. Image editing (crop, rotate, etc.)

- [ ] Open ImageEditor on a captured/imported image.
- [ ] Crop -> cropped result shown in preview and persisted on save.
- [ ] Rotate (90 deg both directions) -> orientation correct in preview and saved file.
- [ ] Other editor actions present in UI (e.g. deskew/border adjustments) each reflect in preview.
- [ ] Cancel discards edits without saving a file or a DB record.

## 6. Document search with filters

- [ ] `/search` -> list loads (`searchDocuments` with no filters).
- [ ] Filter by document type -> only matching documents.
- [ ] Filter by student and by academic year -> results match both.
- [ ] Pagination, sorting (`SortHeader`) -> page/sort changes update results without losing filters.

## 7. Document view / print / export

- [ ] View: open DocumentViewerModal -> image renders; "open external" (`openFileExternal`) and
      "show in folder" (`showFileInFolder`) work.
- [ ] Print (`printFile`) -> print dialog appears / job sent; logged in activity.
- [ ] Export copy (`exportFileCopy`) -> save dialog, chosen destination receives a valid copy.
- [ ] Edit document metadata (`updateDocument`: type, student, academic year, remarks) -> persists.
- [ ] Missing-file case: document whose file was manually removed -> clear error, no crash.

## 8. User management

- [ ] Create user (`createUser`) with role -> new user can log in with correct permissions.
- [ ] Create with a duplicate username -> error shown, no partial record.
- [ ] Deactivate user (`updateUserStatus`) -> that user can no longer log in; list reflects status.
- [ ] Reactivate -> can log in again.
- [ ] Delete user (`deleteUser`) -> removed from list; documented guard behavior for deleting
      yourself / last admin is unchanged.

## 9. Document types

- [ ] Add document type (`createDocumentType`) -> selectable in import and search filters.
- [ ] Delete document type with no documents -> removed from lists.
- [ ] Attempt delete of a type that still has documents -> enforced behavior (block/warn) unchanged.

## 10. Archive directory change and integrity check

- [ ] `/settings` -> change archive directory (`openDirectoryDialog` + `changeArchiveDirectory`,
      both available migration modes) -> subsequent imports land in the new root.
- [ ] Integrity check (`checkArchiveIntegrity`) -> reports exist/missing counts consistent with
      actual files on disk.
- [ ] Archive purge-all (`purgeArchive`) requires password confirmation (do not run on real data;
      verify the confirmation gate only).

## 11. Backup and restore

- [ ] Create backup (`backupCreate`) -> backup zip file produced, activity logged.
- [ ] Modify data (create/soft-delete a throwaway student).
- [ ] Restore backup (`backupRestore`) -> data returns to backup-time state, app still launches and
      logs in afterwards.

## 12. Activity log and dashboard stats

- [ ] `/logs` -> entries appear for login, student CRUD, import, print/export, settings changes.
- [ ] Log list pagination + sort headers work (`getRecentLogs` with limit/offset/sortBy/sortDir).
- [ ] `/` dashboard (`getDashboardStats`) -> counts match actual DB state (students, documents, etc.).

## 13. Recycle bins

- [ ] Student recycle bin: deleted students listed (`getDeletedStudents`), restore and purge behave as in step 2.
- [ ] Document recycle bin: soft-deleted document (`deleteDocument`) disappears from search and
      appears in `getDeletedDocuments`; restore (`restoreDocument`) returns it; purge (`purgeDocument`)
      removes the DB record (and follows the existing file-retention behavior — record what it does, do not "fix" it).

## Regression watch-items

- [ ] No changes to `window.electronAPI` method names/signatures (diff against `electron/preload.js` baseline).
- [ ] No changes to IPC channel names, DB schema, routes, UI markup, or CSS class names.
- [ ] Renderer never receives anything other than the expected `{ success, error, ... }` shapes.
