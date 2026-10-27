# Handoff: AdZU Registrar Archive (refactor summary and security starting points)

Audience: the next developer, who will work on security and optimization with Qoder.
Suggested location in the repo: `docs/HANDOFF.md` (commit it so it travels with the code).

**Provenance.** This was written from a long working session in which the code was
refactored with Qoder. The facts come from the original project zip, from Qoder's
reports and from commands the project owner ran. Anything marked **VERIFY** was not
confirmed against the final code on `main`. The detailed, line-by-line record is in
`REFACTOR_NOTES.md` in the repo; treat that file as the source of truth where the two differ.

---

## 1. Project snapshot

| Item | Value |
|---|---|
| What it is | Offline Windows desktop app for the Registrar's Office: student-centric document archive, scanner/camera import, search, backups, activity log |
| Stack | Electron 28, React 18, TypeScript (strict), Vite 5, Tailwind 4, better-sqlite3 9.6.0, bcryptjs, jscanify 1.4.3 + local OpenCV.js |
| Repo | `https://github.com/yTheCode/Registrar-Document-Archiving-System` (should be **private**; VERIFY) |
| Source of truth | `main` |
| Run | `npm install`, then `npm run dev`. `npm run rebuild` rebuilds better-sqlite3 for Electron. `npm run build:win` builds the installer |
| Checks | `npm run typecheck`, `npm run build`, `npm test`, `npm run lint` |

Work in a clone **outside Google Drive** (for example `C:\dev\registrar-archiving-system`).
Syncing `.git` or `node_modules` through Drive corrupts repos and causes `EPERM` errors.

---

## 2. State of the repo

Restore points (annotated by tag name):

| Tag | Commit | Meaning |
|---|---|---|
| `baseline-before-refactor` | `985caa3` | Original code, clean first commit of the new repo |
| `after-phase-0` | `dfb54ed` | Notes + smoke checklist only |
| `after-phase-1` | `4d81aed` | `electron/main.cjs` split into modules |
| `after-auto-crop` | `04cba01` | Auto-crop on capture restored (feature) |
| `after-phase-3` | `4ccf3ed` | ImportScanner split into components |
| `after-phase-6` | (expected) | Tooling and tests. **VERIFY** it exists: `git ls-remote --tags origin` |

Also **VERIFY** that the README update (commit `e911eda`, branch `docs/readme-structure`)
was merged into `main`, and that `git status` on `main` is clean.

Go back to a known-good state with `git checkout main` then `git reset --hard <tag>`.
`reset --hard` discards local changes; do not push the result unless you mean it.

---

## 3. What was done

| Phase | Result |
|---|---|
| 0 | Baseline recorded, `REFACTOR_NOTES.md`, `REFACTOR_SMOKE_TEST.md` (13-section manual checklist) |
| 1 | `electron/main.cjs` 2,838 lines → about 80 lines (startup + `createWindow`). 46 IPC handlers moved verbatim into 14 `ipc/*.ipc.cjs` files at the time (47 today — `auth:logout` arrived with the session work); shared logic into `db/`, `services/`, `paths.cjs`, `window.cjs`. Channel names, DB schema and `preload.js` unchanged |
| Feature | Capture saves the cropped page when auto-crop is on (see section 5) |
| 3 | `ImportScanner.tsx` 2,309 → 1,446 lines: 19 components and 7 `lib/` files split out. State, effects and handlers **stay in the page** (no hooks extracted yet) |
| 6-lite | ESLint (warnings only), Prettier, Vitest: 9 test files, 109 tests at the end of the refactor (28 files, 304 tests after Phase 1). README updated to the new layout |

**Not done** (see section 9): typed `api.ts` wrapper (Phase 2), Students/Settings/Search splits
(Phase 4), `ImageEditor`/`DocumentViewerModal`/`jscanifyScanner` splits (Phase 5), hook
extraction, the `logActivity()` de-duplication (22 inline `INSERT INTO activity_logs` sites).

---

## 4. Current architecture

```
electron/
  main.cjs            startup + createWindow only
  paths.cjs           userData/db paths; has IMPORT-TIME side effects (mkdir, legacy DB copy)
  window.cjs          getMainWindow()/setMainWindow()
  preload.js          single file (sandboxed preload cannot require local files)
  db/                 connection.cjs (getDb/setDb, initializeDatabase), migrations.cjs
  services/           authz, archivePaths, archiveMigrations, folderNaming, backup,
                      pickedFiles, studentQueries
  ipc/                index.cjs (registerAllIpc) + auth, students, documents, documentTypes,
                      files, users, settings, dialogs, archive, backup, logs, dashboard,
                      images, folders  (*.ipc.cjs)
src/
  pages/              ImportScanner.tsx is a one-line re-export of the feature page
  features/import-scanner/{components (19), lib (7)}
  components/ui, utils, constants, types
tests/                features/import-scanner/lib, utils, electron/services
```

Design points that matter when you change things:

- `db` is **reassigned at runtime** (backup restore closes and reopens it). Always call
  `getDb()` at use time; never write `const db = getDb()` at module level.
- `paths.cjs` runs Electron and filesystem code when it is first required. That is why
  `folderNaming.cjs`, `archivePaths.cjs` and most of `electron/` cannot be imported in a test.
- Moved code must not use `__dirname` for repo-relative paths. Use `ELECTRON_DIR`,
  `PROJECT_ROOT`, `PRELOAD_PATH` from `paths.cjs`.
- Startup archive migrations run from `main.cjs` right after `initializeDatabase()`
  (moved out to avoid a require cycle; both functions swallow errors internally).
- IPC modules register with top-level `ipcMain.handle` and `registerAllIpc()`, not
  `register(ipcMain, deps)`.
- Lazy `require()` calls (`archiver`, `adm-zip`, `electron.shell`, `url`) must stay lazy.
- `electron-builder` packages `electron/**/*`, so the new subfolders ship (checked in `package.json`).

---

## 5. Feature change: auto-crop on capture

The baseline saved a plain full frame on capture; cropping only happened through **Edit**.
Now, with the auto-crop toggle on, `handleCapturePhoto` runs `detectPaperQuad` and saves the
warped page if the detection is confident, otherwise the full frame (with a message).

Key detail: the detector's tuning is in **analysis pixels**, so capture must analyse at the
same size as the live outline (`LIVE_ANALYSIS_MAX_SIDE`, 640). The first version used 1600 and
disagreed with the outline (plain captures, wrong warps). Fixed in `bc5d139`.
`ImageEditor` still analyses at 1600 and offers draggable corners (no automatic crop).

---

## 6. Working with Qoder: rules and traps learned

Method that worked:

1. One branch per phase, one commit per checkpoint, Qoder **stops and reports** after each.
2. You run the app (`npm run dev`) and a short manual test after every checkpoint.
   Compile success does not prove behavior.
3. Merge to `main` and tag only after tests pass. Tags are the restore points.
4. Analysis first (no edits), human review, then execution.
5. Qoder sometimes runs past a checkpoint (Phase 1 steps 3 to 8 landed in one commit).
   Check `git log --oneline` after each report.

Traps already hit (each one is silent to TypeScript):

- Moving code into a subfolder changes `__dirname` (print window preload, two safety checks).
- Passing a ref to a function component as `ref=` delivers `null` in React 18. Use `videoRef`.
- A function that gains a parameter breaks `.filter(fn)` (the index becomes the second argument).
- `vi.mock('electron')` does not intercept `require()` inside `.cjs` files.
- Destructuring from a partly loaded CommonJS module (require cycle) gives `undefined`.
- Tailwind v4 scans every tracked file, including `.md`, so the CSS hash is **not** a signal that
  nothing changed.
- Merging `main` into a branch where a file was `git mv`'d and replaced by a shim conflicts
  on the shim. Keep the shim, port the change to the moved file.

Qoder permission prompts: allow read-only commands (`git status`, `git log`, `grep`,
`npm test`). Deny `git push --force`, `reset --hard`, `clean`, `rm -rf` outside a temp folder,
package installs and edits outside the agreed scope.

---

## 7. Testing and tooling

- `npm test`: 28 files, 304 tests, in `tests/` (kept out of `electron/` and `src/` because
  those folders are packaged). Covers pure renderer logic, the student SQL builders
  (loaded with `createRequire`, no mocks) and, since Phase 1, the 18 suites in
  `tests/electron/security/` plus `tests/scripts/afterPack.test.ts`. Those pin behaviour,
  including known flaws. When you fix a flaw, update its test in the same commit.
- **Not covered:** `folderNaming.cjs`, `archivePaths.cjs` (blocked by `paths.cjs`), anything using
  the DB (the better-sqlite3 binary is built for Electron's ABI, so Node cannot open it),
  `liveOutline.ts`, components.
- `npm run lint`: warnings only (0 errors, about 112 warnings). `npm run format` needs explicit
  file arguments on purpose; it would otherwise rewrite about 73 files.
- `tests/` is not in `tsconfig.json`, so `typecheck` skips it (a `tsconfig.test.json` is the clean fix).
- The manual checklist (`REFACTOR_SMOKE_TEST.md`) is the only behavior check for the UI.

---

## 8. Known issues recorded but **not fixed**

| Area | Issue |
|---|---|
| Archive path | `getArchiveRoot()` falls back to `Documents/ADZU_Archive`, while `resolveArchiveDir()` and `initializeDatabase()` fall back to `userData/Archive`; they diverge if the `archive_directory` setting is missing |
| Archive purge | `PROGRAM_FOLDERS` is duplicated as a literal list inside `archive:purgeAll` |
| Hooks | Early `return` for non-admins sits above dozens of hooks in `Settings.tsx`, `ActivityLog.tsx`, `ImportScannerPage.tsx` (latent; routes are admin-only) |
| Camera | "Native Max" quality option is intermittent and can be a combined per-axis maximum no mode supports |
| Import | `handleImageEdit` uses a stale `filesWithMetadata` during an Edit-All pass; orphaned files after a failed batch save; a dead "Not Student-Specific" branch |
| lib | `getReviewWindow` clamps only the top page (page 0 gives `start: -5`); `isEditableImage` throws on rows with only `filePath`; `parseInt(documentTypeId)` accepts `'1abc'`, `'2.9'`, `'0x2'`; `filterStudents` does not trim and matches across concatenated fields |
| Dates | `formatDate`/`formatTimestamp` throw `RangeError` on an invalid date |
| Search | Unescaped `%` and `_` in `LIKE` terms (wildcards, not injection); ASCII-only case folding; `String(null)` becomes `'%null%'` (latent) |
| CSS | Tailwind scans `.md`/test files and emits unused rules; narrow `@source` to `src/` |

Full list with line numbers: `REFACTOR_NOTES.md` ("Suspected bugs", "After the defense", section 8.5).

---

## 9. Not verified / open items

- **Full smoke run:** only sections 3, 4, 5 plus per-checkpoint spot checks were done. Run all 13
  sections on the final `main` before relying on it.
- **Installer:** `npm run build:win` has not been run since the refactor. Install the result and
  check login, one import, **printing** (uses the moved preload path) and the unsafe-directory refusal.
- **README leftovers:** the "39 methods" figure was corrected to 47 in Phase 1D (the preload has
  47 `invoke` calls); a stale
  folder name in section 13, section 2 omits `src/features`, section 3 omits the new devDependencies.
- **Old GitHub repo** from before the restart: confirm it is private or deleted and that no real
  student data or database file is in its history.
- Remaining refactor candidates: typed `src/services/api.ts`, `logActivity()` helper, merging
  `SessionStudentPicker` and `DocumentStudentField`, hook extraction (lowest risk first:
  reference data, confirm dialog, add-student; leave camera hooks and `resetAll` for last).

---

## 10. Security: what is known and what to check

The refactor kept behavior identical on purpose, so **no security fix was made during it**.
Phase 1 (branches `security/p1a-identity`, `security/p1b-electron-hardening`,
`security/p1c-files-and-paths`, `security/p1d-docs-and-verify`) has since changed the code for
Q1–Q7, Q11 and Q13. The authoritative, row-by-row record is `docs/SECURITY_REGISTER.md`; the
table below is the original analysis and its "check or do" column is only current where the
register still says `open`.
Items below mix findings from Qoder's analysis with checks nobody has done yet.

| # | Area | Known | Check or do |
|---|---|---|---|
| 1 | **Authorization** | Admin-only handlers call `isAdmin(userId)` (27 of them), and the `userId` still comes from the renderer — but since Q5 the main process also keeps the logged-in session and `isAdmin` accepts only that account's id, re-reading `role, status`. Since Q6 every channel also passes a sender guard. The 18 channels still needing **no login** are listed in the register (§5, R3): `students:getAll/search/getById/getFilterOptions`, `documents:search`, `documentTypes:getAll`, `settings:get`, `dashboard:getStats`, `folders:generatePath`, `image:saveBase64`, `file:copy`, the `file:open*/read*/show*` family, and the two dialogs | Decide whether those 18 must require a login (R3 is still open); Q5/Q6 are done |
| 2 | Session | Renderer keeps the user in `sessionStorage` key `user`; role-based routes are enforced in React only | Treat the renderer as untrusted; the real check belongs in main |
| 3 | Login | bcryptjs, cost 10 (per README) | VERIFY: lockout or rate limiting, default admin account and password seeded at first run, password rules |
| 4 | **File paths** | `file:copy` and `image:saveBase64` use `validateAndResolvePath`; `file:readPickedAsBase64` is limited to files picked in a dialog and blocks forbidden folders | VERIFY that every other file handler (`readAsBase64`, `openExternal`, `showInFolder`, `print`, `exportCopy`) confines paths to the archive root, including `..`, absolute paths and UNC paths |
| 5 | Opening files | `file:openExternal` opens a file with the OS handler | Allowlist extensions (pdf, images) on import and on open so a stored `.exe` cannot be launched |
| 6 | Input limits | Base64 payloads come over IPC | VERIFY size and type checks (memory exhaustion, wrong types) on all handler arguments |
| 7 | SQL | Student search builders use parameters (a test pins that user text never enters the SQL string); sort columns are whitelisted | Grep for any other string interpolation into SQL, especially `ORDER BY`, table names in `rebuildTable` and the inline `sortColumns` |
| 8 | **Backup/restore** | `adm-zip` extraction; `isSafeArchiveTarget` guards targets; backup contains the DB with password hashes | VERIFY zip-slip protection (entry names with `..`), validate the zip before replacing the live DB, consider protecting backups |
| 9 | Purge all | Needs password confirmation (per checklist) | VERIFY the password is checked in the **main** process, not only in the UI |
| 10 | Audit log | `logs:add` is callable from the renderer | Renderer-written entries can be forged; log security-relevant events from main |
| 11 | **Electron hardening** | `contextIsolation: true` and `nodeIntegration: false` are set; `sandbox` is not set explicitly and stays on by Electron 28's default | Done in Phase 1: production means packaged (Q1), no DevTools/menu/reload keys when packaged (Q2), print window without a preload (Q4), pop-ups/navigation/webviews/permissions denied except camera video (Q7), three Electron fuses off (Q13). Still open: **no CSP**, and `sandbox` is implicit rather than stated |
| 12 | **Dependencies** | `npm install` reported 23 vulnerabilities (4 moderate, 17 high, 2 critical). Electron 28 is far behind supported releases | Run `npm audit`, separate dev-only from runtime issues, **do not** run `npm audit fix --force`. Plan an Electron upgrade as its own risky phase (native module rebuild) |
| 13 | Data at rest | SQLite DB and archived files are plain on disk | Document the expectation (BitLocker/OS permissions) or evaluate encryption |

---

## 11. Suggested security roadmap

One branch and one tag per item; stop after each checkpoint; run the smoke checklist for the area.

| Step | Work | Notes |
|---|---|---|
| S0 | Threat model (one page), `npm audit` triage, confirm no secrets or data in git history | No code changes |
| S1 | **Central authorization in the main process** | Biggest win. Keep the `preload.js` API unchanged: store the logged-in user in main (keyed by `event.sender.id`) at `auth:login`, ignore a renderer-supplied `userId`, add `requireLogin`/`requireAdmin` wrappers in `services/authz.cjs`. Add tests for the pure decision logic |
| S2 | Path confinement, extension allowlist, size limits | Add tests; `archivePaths` is not testable today (see below) |
| S3 | Electron hardening (items 11, 5) | Check each setting in the app, including print |
| S4 | Backup/restore safety, purge confirmation, log integrity | Test with a hostile zip |
| S5 | Dependency fixes, then the Electron upgrade | Own branch; rebuild better-sqlite3; run the installer check |
| S6 | Data-at-rest decision | Mostly documentation and configuration |

Make it testable first (small, behavior-adjacent): either extract pure naming rules into
`folderNamingRules.cjs`, or make `paths.cjs` initialize lazily. Both options are in
`REFACTOR_NOTES.md` section 11.4. `paths.cjs` documents its import-time ordering, so change it carefully.

### Rules block to paste at the start of each Qoder session in the security phase

```
You are working on the Electron + React app adzu-registrar-archive (see docs/HANDOFF.md).
This is a SECURITY phase. Unlike the earlier refactor, behavior may change, but ONLY for the
specific item I name, and only where it closes a risk.
1. Do not change IPC channel names or window.electronAPI method names/signatures, or the DB
   schema, unless I explicitly approve it.
2. Work in checkpoints. After each: run typecheck, build, npm test and lint, show git
   diff --stat, commit, then STOP and wait for my "continue".
3. For each change, add or update a test, and add a line to REFACTOR_NOTES.md saying what
   changed, why, and which manual check proves it.
4. Report anything suspicious you find instead of fixing it silently.
5. Never change application code just to make a test pass; ask me.
6. db is reassigned at runtime: call getDb() at use time. Use ELECTRON_DIR/PROJECT_ROOT/
   PRELOAD_PATH from paths.cjs instead of __dirname in moved code.
7. Do not commit *.db files, dist/, release/, node_modules/ or any student data.
```

---

## 12. Environment gotchas

- PowerShell blocks `npm.ps1` by default: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.
- If `npm install` fails compiling `better-sqlite3`, either add the **Windows 10/11 SDK** to Visual
  Studio Build Tools (the error reads "missing any Windows SDK") or use Node 20 LTS.
  Node 22.11 worked with only harmless `EBADENGINE` warnings.
- `postinstall` copies the scanner assets into `public/scanner/` (git-ignored, regenerated).
- `.gitattributes` has `* text=auto`; the "LF will be replaced by CRLF" warnings are normal.
- Never commit `*.db`, `dist/`, `release/`, `node_modules/`, `public/scanner/`.
- The development database lives in the Electron userData folder, not the repo. Back it up
  before experiments (backup/restore tests replace it).
- The Windows installer, the camera and the printer cannot be tested by the unit tests. They
  need hands-on checks.

---

## 13. Where to read more

- `REFACTOR_NOTES.md`: dependency maps, decisions, execution log (sections 8 to 11), suspected bugs, "After the defense".
- `REFACTOR_SMOKE_TEST.md`: the 13-section manual checklist.
- `QODER_REFACTOR_PLAYBOOK.md`: the Global Rules and phase prompts used so far (commit it to `docs/`).
- `README.md`: architecture, schema, IPC reference, RBAC matrix (updated to the new layout; a few stale details remain, see section 9).
