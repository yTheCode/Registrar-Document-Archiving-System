# Phase 1A — who can call what (Q5/Q6 analysis)

Analysis only. No application file was changed in this checkpoint.

| Item | Value |
| --- | --- |
| Branch | `security/p1a-identity` (from `origin/main`, commit `8ee536a`) |
| Date | 2026-10-27 |
| Method | Read every `electron/ipc/*.ipc.cjs`, `electron/services/authz.cjs`, `electron/main.cjs`, `electron/window.cjs`, `electron/preload.js`, `src/App.tsx`; counted `ipcMain.handle(` and `isAdmin(` with grep. Line numbers are for `8ee536a` |

---

## 1. Counts (verified)

| Measure | Count |
| --- | --- |
| `ipcMain.handle` channels | **46** |
| Channels that call `isAdmin(...)` | **27** |
| Channels with no authorization check | **19**, of which `auth:login` is public by design → **18 unguarded** |
| `isAdmin` call sites | 27 (+1 definition in `services/authz.cjs:6`) |
| Preload `ipcRenderer.invoke` methods | 46 (same set) |

### Where the numbers differ from older documents

The phase prompt says "the Phase 1 document claims 36 admin handlers". **No file in
this repository claims 36.** I could not reproduce that number from any of them:

| Source | Claim | Reality |
| --- | --- | --- |
| `HANDOFF.md` §10 row 1 | "about 27 of them" | 27 — matches |
| `docs/SECURITY_REGISTER.md` §5 | "27 channels call `isAdmin(...)`; 19 do not" | 27 / 19 — matches (its 19 includes the public `auth:login`) |
| `README.md` §"preload bridge" (~line 468) | "**39 methods**"; per-namespace table | 46 methods; counting the table's own `admin-only` marks gives 26, and `archive:purgeAll` is missing from the table entirely though it is guarded → 27 |
| Phase 1 planning document | "36 admin handlers" | Not in the repo — **please say where this number came from** |

So the real numbers are 46 channels, 27 admin-guarded, 1 public, and 18 unguarded.
The Phase 1 document is either counting a different set (e.g. all mutating channels)
or is out of date; nothing under `electron/` supports 36.

---

## 2. Every channel, its check today, and the argument it treats as the actor

`actor` = the argument `isAdmin()` receives (the claimed caller).
`target` = what the handler actually changes. Payload = the IPC argument shape.

### auth (`electron/ipc/auth.ipc.cjs`)

| Channel | Line | Check today | Actor argument |
| --- | --- | --- | --- |
| `auth:login` | 8 | none (public) | — (returns the account) |

### students (`electron/ipc/students.ipc.cjs`)

| Channel | Line | Check today | Actor argument | Target |
| --- | --- | --- | --- | --- |
| `students:getAll` | 9 | **none** | — | — |
| `students:search` | 21 | **none** | — | — |
| `students:getFilterOptions` | 36 | **none** | — | — |
| `students:getById` | 50 | **none** | — | — |
| `students:create` | 59 | `isAdmin(userId)` :62 | 2nd arg `userId` | new row |
| `students:update` | 138 | `isAdmin(userId)` :141 | `userId` inside payload | `id` (separate) |
| `students:delete` | 193 | `isAdmin(userId)` :196 | 3rd arg `userId` | `id` |
| `students:getDeleted` | 221 | `isAdmin(userId)` :223 | 2nd arg `userId` | — (read) |
| `students:restore` | 242 | `isAdmin(userId)` :244 | 3rd arg `userId` | `id` |
| `students:purge` | 258 | `isAdmin(userId)` :260 | 3rd arg `userId` | `id` |

### documents (`electron/ipc/documents.ipc.cjs`)

| Channel | Line | Check today | Actor argument | Target |
| --- | --- | --- | --- | --- |
| `documents:delete` | 13 | `isAdmin(userId)` :16 | `userId` inside payload | `id` |
| `documents:getDeleted` | 46 | `isAdmin(opts.userId)` :49 | `userId` nested in `opts` | — (read) |
| `documents:restore` | 94 | `isAdmin(userId)` :96 | 3rd arg `userId` | `id` |
| `documents:purge` | 122 | `isAdmin(userId)` :124 | 3rd arg `userId` | `id` |
| `documents:update` | 175 | `isAdmin(userId)` :177 | `userId` inside payload | `id` |
| `documents:search` | 279 | **none** | — | — |
| `documents:createBatch` | 367 | `isAdmin(userId)` :370 | `userId` inside payload | new rows |

### document types (`electron/ipc/documentTypes.ipc.cjs`)

| Channel | Line | Check today | Actor argument | Target |
| --- | --- | --- | --- | --- |
| `documentTypes:getAll` | 8 | **none** | — | — |
| `documentTypes:create` | 17 | `isAdmin(userId)` :20 | `userId` inside payload | new row |
| `documentTypes:delete` | 36 | `isAdmin(userId)` :39 | `userId` inside payload | `id` |

### files (`electron/ipc/files.ipc.cjs`)

| Channel | Line | Check today | Actor argument | Notes |
| --- | --- | --- | --- | --- |
| `file:copy` | 13 | **none** | — | writes into the archive |
| `file:openExternal` | 39 | **none** | — | OS shell |
| `file:showInFolder` | 59 | **none** | — | OS shell |
| `file:readAsBase64` | 79 | **none** | — | reads any archive file |
| `file:readPickedAsBase64` | 136 | **none** (not authz: picked-file Set + forbidden-dir list) | — | reads a picked file |
| `file:print` | 171 | **none** | `userId` is written into `activity_logs` unchecked | OS shell / print |
| `file:exportCopy` | 258 | `isAdmin(userId)` :262 | `userId` inside payload | writes outside archive |

### users (`electron/ipc/users.ipc.cjs`)

| Channel | Line | Check today | Actor argument | Target |
| --- | --- | --- | --- | --- |
| `users:getAll` | 9 | `isAdmin(userId)` :12 | 2nd arg `userId` | — (read) |
| `users:create` | 38 | `isAdmin(createdBy)` :41 | `createdBy` | new account |
| `users:updateStatus` | 59 | `isAdmin(updatedBy)` :62 | **`updatedBy`** | **`userId`** |
| `users:delete` | 94 | `isAdmin(deletedBy)` :97 | **`deletedBy`** | **`userId`** |

### settings / dialogs / archive / logs / dashboard / image / folders / backup

| Channel | Line | Check today | Actor argument |
| --- | --- | --- | --- |
| `settings:get` | settings:7 | **none** | — |
| `settings:set` | settings:16 | `isAdmin(userId)` :19 | `userId` inside payload |
| `dialog:openFile` | dialogs:9 | **none** | — |
| `dialog:openDirectory` | dialogs:19 | **none** | — |
| `archive:purgeAll` | archive:24 | `isAdmin(userId)` :27 **+ password re-check** :33-39 | `userId` inside payload |
| `archive:changeDirectory` | archive:175 | `isAdmin(userId)` :177 | `userId` inside payload |
| `archive:checkIntegrity` | archive:266 | `isAdmin(userId)` :268 | `userId` inside payload |
| `logs:add` | logs:8 | `isAdmin(userId)` :10 | `userId` inside payload |
| `logs:getRecent` | logs:25 | `isAdmin(userId)` :28 | 3rd arg `userId` |
| `dashboard:getStats` | dashboard:7 | **none** | — |
| `image:saveBase64` | images:11 | **none** | — (writes into the archive) |
| `folders:generatePath` | folders:11 | **none** | — (`mkdir` under `archiveRoot`) |
| `backup:create` | backup:15 | `isAdmin(userId)` :16 | 2nd arg `userId` |
| `backup:restore` | backup:114 | `isAdmin(userId)` :115 | 2nd arg `userId` |

---

## 3. Actor vs target: does any handler pass the target to `isAdmin`?

**No.** Both handlers where a field is called `userId` but is really the target are
correct today:

- `users:updateStatus` receives `{ userId, status, updatedBy }`. `userId` is the
  account being changed; the guard is `isAdmin(updatedBy)` (`users.ipc.cjs:62`), and
  the log row is written with `updatedBy` (`:86`). Correct.
- `users:delete` receives `{ userId, deletedBy }`. The guard is
  `isAdmin(deletedBy)` (`:97`), the self-delete check is `userId === deletedBy`
  (`:101`), and the log uses `deletedBy` (`:129`). Correct.

`students:create` / `students:update` / `students:delete` and the document handlers
all pass the account id they also use for the activity log, which is the actor.

**Conclusion for CP3:** no call site needs to be re-pointed at the actor. The Q5 fix
does not have to touch any handler body.

The real weakness is one level up: the renderer chooses the actor id. Any renderer
can send `1` (the default admin) as `userId`/`createdBy`/`updatedBy`/`deletedBy` and
pass every check. That is threat T1 / risk R1, and it is what the stored session fixes.

---

## 4. `isAdmin` today — does it re-read the row, and does it check `active`?

`electron/services/authz.cjs:6-10`:

```js
async function isAdmin(userId) {
  if (!userId) return false;
  const user = getDb().prepare('SELECT role FROM users WHERE id = ?').get(userId);
  return user && user.role === 'admin';
}
```

- It **does** re-read the `users` row on every call through `getDb()` (not cached),
  so it survives a backup/restore handle swap.
- It selects **only `role`**. There is no `status` condition and no `deleted_at`
  condition. **A deactivated admin therefore keeps full authority**: setting
  `status = 'inactive'` on an admin changes nothing for an already-running session,
  and any renderer that sends that admin's id keeps passing.
  `archive:purgeAll` is the only handler that re-checks `status = 'active'` itself
  (`archive.ipc.cjs:33-39`) — for the password re-check, not as a general rule.
- A hard-deleted user (users are hard-deleted, `users.ipc.cjs:125`) has no row, so
  `isAdmin` returns false. A legacy soft-deleted row (`deleted_at` set, migration
  `db/migrations.cjs:29-40`) would still return true today.
- `isAdmin` is declared `async` but its body is synchronous; all 27 call sites
  `await` it, so changing the body (not the signature) is safe.

---

## 5. Login, where the renderer stores the user, and every logout

**`auth:login`** (`electron/ipc/auth.ipc.cjs:8-37`):
1. `SELECT * FROM users WHERE username = ? AND status = 'active' AND deleted_at IS NULL`
   (`deleted_at` exists only because `db/migrations.cjs:31-33` added it).
2. `bcrypt.compareSync(password, user.password_hash)` (blocking, cost 10).
3. Same error text for unknown user and wrong password.
4. Writes an `activity_logs` row with action `login` (best-effort, inside the try).
5. Returns `{ success: true, user: { id, username, role } }` — no token, no session,
   nothing the main process remembers.

**Renderer storage** (`src/App.tsx`):
- read on mount: `sessionStorage.getItem('user')` → `setUser(JSON.parse(...))` (`:31-34`)
- written on login: `sessionStorage.setItem('user', JSON.stringify(user))` (`:40`)
- removed on logout: `sessionStorage.removeItem('user')` (`:45`)

**Every logout path:** exactly one. `App.tsx:43 handleLogout` is passed to
`Layout` (`:91`) and fired by the sidebar Logout button (`src/components/Layout.tsx:154`).
Nothing else clears the user (`Login.tsx` has no logout code; the app has no
auto-logout timer). `src/pages/ActivityLog.tsx:87` *displays* rows whose action
contains "logout", but **nothing writes such a row today**.

Consequence: closing the window, reloading the renderer (`Ctrl+R`, which resets
`sessionStorage`) or a crashed renderer ends the UI session without telling main;
after Q5, a reload would leave main with a session the renderer no longer knows
about. CP3's "clear on window close" covers the close path; a renderer reload is
out of scope and is noted in §9.

---

## 6. Can the app ever have more than one main window?

`electron/main.cjs`:
- `createWindow()` (`:12-35`) is called once from `app.whenReady()` (`:60`) and again
  from `app.on('activate')` **only when `BrowserWindow.getAllWindows().length === 0`**
  (`:62-66`, the macOS convention).
- `app.on('window-all-closed')` closes the DB and quits on every platform except
  darwin (`:73-78`).
- On the Windows target, therefore: **at most one main window exists at a time.**
- `setMainWindow()` (`window.cjs:10`) replaces the module-level handle; **nothing
  clears it when the window closes**, so after a close `getMainWindow()` returns a
  destroyed window until a new one is created.

There is a **second `BrowserWindow`** that is not the main window:
`file:print` creates a hidden print window (`files.ipc.cjs:218-228`) that loads a
generated `%TEMP%/adzu-print-*.html` file and — important for Q6 — **uses the app
preload (`PRELOAD_PATH`)**, so that temp `file://` page also has `window.electronAPI`
and can reach all 46 channels. It never invokes IPC today, but it is exactly the kind
of sender Q6 must reject.

---

## 7. Channels with no authorization at all (listed only — DO NOT FIX in 1A)

18 channels. Ordered by what they expose:

| Channel | Exposes |
| --- | --- |
| `students:getAll`, `students:search`, `students:getById`, `students:getFilterOptions` | Full student PII, paginated and searchable |
| `documents:search` | Document metadata joined with student PII |
| `settings:get` | Any setting, including `archive_directory` |
| `dashboard:getStats` | Counts + last 10 documents with student PII |
| `documentTypes:getAll` | Low |
| `file:readAsBase64` | Whole file contents as base64 (archive-contained) |
| `file:readPickedAsBase64` | Picked-file contents (not archive-contained, but dialog-gated + forbidden-dir list) |
| `file:print` | Hands an archive file to the OS print pipeline / external app; writes a log row with a caller-chosen `userId` |
| `file:openExternal`, `file:showInFolder` | OS shell on an archive path |
| `file:copy` | Copies any caller-chosen source path into the archive (destination is validated) |
| `image:saveBase64` | Writes a caller-chosen base64 buffer into the archive |
| `folders:generatePath` | `mkdir` under a caller-supplied `archiveRoot` |
| `dialog:openFile`, `dialog:openDirectory` | Native dialogs (and `openFile` adds picked paths to the read allowlist) |
| `auth:login` | Public by design |

These stay as they are in 1A. Note that after Q6 every one of them still requires
the call to come from the real main window — that is the only restriction 1A adds to
them.

---

## 8. Findings that affect the CP3 design

1. **Deactivated admin keeps authority** (§4) — CP3 must add `status = 'active'` (and
   reject `deleted_at`) to the row read, which `decideAdmin` will express as a pure
   rule.
2. **No act/target confusion to fix** (§3) — no handler body changes needed.
3. **Backup restore replaces the `users` table.** The session stores a `userId`; after
   `backup:restore` that id may belong to a different account in the restored data.
   CP3 keeps `isAdmin` re-reading the row, so the decision follows the *restored*
   row. Clearing the session on restore would be stricter but is **not** in the 1A
   scope; recorded for the owner.
4. **Renderer reload vs main session.** `sessionStorage` disappears on reload while
   the main-process session persists, so after a reload the renderer shows the login
   screen and any admin call it made with a stale id would still pass (until the
   window closes). Not fixed in 1A (spec only requires clear-on-window-close);
   recorded for the owner.
5. **Print window has the bridge.** Q6's sender check must reject it; the print flow
   itself never invokes IPC, so printing should keep working.
6. **`getMainWindow()` may return a destroyed window** after close; the sender guard
   must treat a destroyed window as "no main window" and reject.
7. **No CSP / navigation guard** (register R11) — Q6 is a sender check, not a
   replacement for that; R11 stays open.

## 9. What CP2–CP5 will do (for review)

- **CP2** `electron/security/session.cjs` (factory + one shared instance, no electron
  import) and `electron/security/adminDecision.cjs`
  `decideAdmin({ session, userId, row })` → true only for a live session whose
  `userId` equals the argument (compared as strings, so `1` and `"1"` are the same
  account) and a row with `role === 'admin'` and `status === 'active'`.
- **CP3** `isAdmin` = session + fresh row + `decideAdmin`; `auth:login` sets the
  session on success only; new `auth:logout` clears it; main window `closed` clears
  it; preload/types gain `logout()`; `App.tsx handleLogout` calls it before clearing
  `sessionStorage`. No handler body changes.
- **CP4** `electron/security/senderGuard.cjs`
  `createSenderGuard({ getMainWebContents, isAllowedUrl })` + a URL policy module used
  by `main.cjs` (packaged: the `dist/index.html` file URL; dev: `http://localhost:5173`
  origin as well). `ipc/index.cjs` installs a single `ipcMain.handle` wrapper around
  the 14 module requires and restores the original method afterwards, so no handler
  file changes.
- **CP5** tests for all pure pieces plus a static test that any `*.ipc.cjs` module is
  loaded only through `ipc/index.cjs`, nothing outside `electron/ipc/` registers a
  handler, and the wrapper is installed before the first module require.
