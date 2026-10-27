# P1D CP2 — documentation corrections (Q10, analysis only)

Branch `security/p1d-docs-and-verify`, base `origin/main` = `b6ea594` (P1A + P1B + P1C merged).
This document lists every statement in the repository's written material that does **not**
match the code as it is now. It changes no application file and no README wording: the fixes
are applied in a separate commit after the owner approves which rows to change.

Status: **analysis for review.** Nothing below has been edited yet.

## 1. Method

| Check | How it was made |
| --- | --- |
| Preload surface | `electron/preload.js` read in full; 47 top-level keys, 47 `ipcRenderer.invoke` calls |
| IPC channels | `grep -rc "ipcMain.handle(" electron/ipc/*.cjs` → 47 sites; `grep -rhoE "ipcMain\.handle\('[^']+'"` → 47 unique names |
| Journal mode | `grep -rn "journal_mode\|pragma" electron/` → only `db.pragma('foreign_keys = OFF')` (`electron/db/connection.cjs:45`, `electron/db/migrations.cjs:222,232`) and `probe.pragma('integrity_check')` (`electron/services/backup.cjs:41`). No `journal_mode` is ever set |
| Password change | `electron/ipc/users.ipc.cjs` read in full (4 handlers) and the preload list above; no update-password channel exists |
| Router | `src/App.tsx:2-4` (HashRouter) |
| Build config | `node -e "require('./package.json').build"` |
| Tests | `npm test` on this branch: 28 files, 304 tests (`tests/` tree read with `find tests -type f`) |
| Package versions | `package.json` `dependencies` / `devDependencies` |

## 2. Verified numbers (use these in the SRS and slides)

| Fact | Value | Evidence |
| --- | --- | --- |
| IPC channels (`ipcMain.handle`) | **47** | 47 matches, 47 unique names, 14 `*.ipc.cjs` modules |
| `window.electronAPI` methods | **47** | `electron/preload.js`, one per channel |
| Admin-guarded channels | 27 checked by `isAdmin`, plus session/sender rules on all 47 | `docs/SECURITY_REGISTER.md` §5 (P1A) |
| Session-only channels | 2 (`auth:login`, `auth:logout`) | `electron/ipc/auth.ipc.cjs` |
| SQLite journal mode | **default (`delete`)** — no `journal_mode` pragma is executed | see §1 |
| Renderer | React 18.2 + TypeScript 5.3 (strict), Vite 5, Tailwind 4 beta | `package.json` |
| Router | `HashRouter` (react-router-dom 6.21) | `src/App.tsx:2-4` |
| Default archive root | `%APPDATA%\adzu-registrar-archive\Archive` (`userData\Archive`) | `electron/paths.cjs` (`DEFAULT_ARCHIVE_ROOT`), `electron/security/archiveRoot.cjs` |
| Test suites | 28 files, 304 tests, 0 failures | `npm test` |
| Lint | 0 errors, 112 warnings | `npm run lint` |

## 3. README.md

Rows marked **fix** are wording I will change on approval; **report** rows are recorded only
(the default-credentials block is Q8 and belongs to the team).

| # | Line | Claim as written | What the code does | Action |
| --- | --- | --- | --- | --- |
| RM1 | 66 | mermaid node: `→ 39 whitelisted methods` | 47 methods | fix → 47 |
| RM2 | 132 | `preload.js # Preload bridge: 39 contextBridge-exposed methods` | 47 | fix → 47 |
| RM3 | 466 | `The preload bridge exposes **39 methods** across these namespaces:` | 47; the table below it lists 45 (no `auth.logout`, no `archive.purgeAll`) | fix → 47, add the two rows |
| RM4 | 855 | `inject only 39 specific named methods` | 47 | fix → 47 |
| RM5 | 891 | `Exact list of 39 exposed bridge methods` | 47 | fix → 47 |
| RM6 | 102 | `Hash-free `BrowserRouter` works within Electron's Chromium renderer` | `HashRouter` since P1B cp7 (`src/App.tsx:2-4`); a history-API path on a `file://` document blanked the packaged window | fix → HashRouter and the reason |
| RM7 | 170 | `src/assets/adzu-seal.png # University seal (window icon + branding)` | window/exe icon is `build/icon.ico` (+ `build/icon.png` via `extraResources`); in-app branding is `src/assets/logo-256.png`; `adzu-seal.png` is still in the tree but unreferenced | fix |
| RM8 | 806-814 | Build-config snippet: `"icon": "src/assets/adzu-seal.png"`, no `afterPack`, no `extraResources`, `files` without the exclusion patterns | `build.win.icon = build/icon.ico`; `afterPack: scripts/afterPack.cjs`; `extraResources: build/icon.png → resources/icon.png`; `files` also excludes `node_modules/jscanify|canvas|jsdom` | fix |
| RM9 | 861 | `better-sqlite3 uses WAL (Write-Ahead Logging) mode implicitly` | No `journal_mode` pragma exists anywhere; SQLite runs in its default rollback-journal (`delete`) mode. `db.backup()` (the online backup API) does not require WAL. The sidecar cleanup in restore is still correct | fix |
| RM10 | 837 | `Password change \| ✅ Implemented \| Admins can set user passwords via users:create and users:updateStatus` | `users:create` sets a password for a **new** account only; `users:updateStatus` writes `status` only; there is no password-update channel, no UI and no self-service change | fix → not implemented |
| RM11 | 761 | `Change these passwords immediately after first login ... via Settings → User Accounts → the account's menu` | No such control exists (same cause as RM10) | **report only** — Q8 territory, not edited here |
| RM12 | 754-759 | Default credentials table | Still accurate (seeded in `electron/db/connection.cjs`) | **report only** — Q8 |
| RM13 | 777 | `currently 9 files / 109 tests` and a suite list without the security suites | 28 files / 304 tests, including 18 files in `tests/electron/security/` and `tests/scripts/afterPack.test.ts` | fix |
| RM14 | 513-521 | `isAdmin` shown as `SELECT role FROM users WHERE id = ?; return user && user.role === 'admin'` | `electron/services/authz.cjs:1-15`: the id must equal the main-process session's user, then `SELECT role, status` is re-read and `decideAdmin(...)` requires `role === 'admin'` **and** `status === 'active'` | fix |
| RM15 | 523 | `The userId passed through every IPC call is cross-referenced against the database on every request` | True, and since P1A it must also match the main-process session (a renderer-supplied id for another account is rejected before the row read) | fix (one sentence) |
| RM16 | 858 | Q&A: `isAdmin` performs `SELECT role FROM users WHERE id = ?` | Same as RM14; the session check is the extra layer | fix |
| RM17 | 468-484 | Method table | 45 rows listed; actual 47 (`auth.logout`, `archive.purgeAll` missing) | fix (same edit as RM3) |
| RM18 | 122-287 | Project-structure tree | Missing `electron/security/` (8 pure modules), `scripts/afterPack.cjs`, `build/icon.ico` + `icon.png`, `src/assets/logo-256.png`, `tests/electron/security/`, `tests/scripts/` | fix (structure only) |
| RM19 | 268-269 | `database/ # Legacy path ... registrar_archive.db` | The folder is not in this clone; only `database/*.db*` is gitignored. `electron/paths.cjs` still probes `<repo>/database/registrar_archive.db` for a one-time copy, so the path is real for old installs | fix (mark "only on machines upgraded from the pre-refactor build") |
| RM20 | 835 | `Session expiry ... session (stored in sessionStorage)` | Still true for the UI, but since P1A the main process also holds the session and clears it on `auth:logout` and window close; a renderer reload keeps the main session (register R18) | fix (one sentence) |
| RM21 | 841 | `Frontend activity logging from non-admin users (e.g., login events) is done through internal main-process writes, not through logs:add` | The renderer **does** call `logs:add` (5 sites: `ImportScannerPage.tsx:235`, `Students.tsx:238,263,342,381`); login is logged in main (`auth.ipc.cjs:27`) | fix |

Notes that are accurate and need no change: `contextIsolation: true` / `nodeIntegration: false`
(§1, §2, §17), the default-archive path in §5 (matches Q11 for new installs), the `%APPDATA%`
pre-creation in `INSTALL_AND_RUN.cmd` (§13), the scanner pipeline (§10), the RBAC matrix (§8,
still enforced in the renderer with main-process re-validation).

Optional clarification (no fix proposed): §2 calls the renderer “sandboxed”. It is, by
Electron 28's default, but `main.cjs` does not set `sandbox` explicitly — the register already
lists confirming that as a manual check.

## 4. HANDOFF.md

| # | Line | Claim | Now | Action |
| --- | --- | --- | --- | --- |
| HH1 | 56 | `46 IPC handlers moved verbatim into 14 ipc/*.ipc.cjs files` | 46 at refactor time; 47 today (`auth:logout` arrived with Q5) | fix (one parenthetical) |
| HH2 | 59, 150 | `9 test files, 109 tests` | 28 files, 304 tests | fix |
| HH3 | 188 | `"39 methods" in preload.js (it has 46 invoke calls; VERIFY)` | 47 invoke calls; the "39" is still stale in README | fix |
| HH4 | 200 | `The refactor kept behavior identical on purpose, so **no security fix has been made**` | False since P1A: Q1–Q7, Q11–Q13 are merged | fix |
| HH5 | 205 | Item 1: `Qoder found no session check at all in the main process`; long unguarded list | Main-process session added (Q5); every channel now passes the sender guard (Q6); the 18 data/file channels still need no login (R3) | fix (pointer to the register) |
| HH6 | 215 | Item 11: `VERIFY sandbox, webSecurity, a CSP, will-navigate and setWindowOpenHandler` | Pop-ups, away-navigation, webviews and permissions are handled (Q2/Q7), DevTools is off when packaged, fuses are flipped (Q13); **no CSP yet** | fix |
| HH7 | 41 | `after-phase-6 (expected) ... VERIFY it exists` | Historical VERIFY note; nothing to assert now | report only |
| HH8 | 224-236 | Roadmap S1–S6 all "to do" | S1 and S3 are largely delivered by P1A/P1B; S2 partially (Q3, Q11); S5/S6 untouched | fix (status column) |

HANDOFF §9 (installer not re-run, partial smoke run) is still true and needs no change.

## 5. REFACTOR_SMOKE_TEST.md

| # | Line | Claim | Now | Action |
| --- | --- | --- | --- | --- |
| SM1 | 13 | `Reload app while logged in (sessionStorage cleared on restart) -> back at login screen` | Still true for the screen, but the main-process session survives a renderer reload (register R18, accepted) | fix (add the caveat) |
| SM2 | 110-114 | Regression watch-items: "no changes to method names / channels" | Unchanged in P1A–P1D; still the right guard | none |

## 6. docs/SECURITY_REGISTER.md

No correction needed: §3 and §5 keep the S0 baselines ("46 channels") and §5 already states the
current 47, R1/R2/R6/R17/R21–R23 carry their Q-status. CP4 adds the Q10/Q12 rows.

## 7. Claims checked and found absent from this repository

These are asked about in the phase prompt because the SRS or slides may state them; no file in
this repository claims them, so there is nothing to correct here:

- “plain HTML/CSS/JS” UI — README/HANDOFF correctly say React 18 + TypeScript.
- “Repository Pattern”, `StudentRepository`, `DocumentRepository` — zero matches anywhere;
  data access is `getDb().prepare(...)` inside the IPC handlers and `electron/services/*.cjs`.
- A change-password feature — no channel, no UI; the only related false statement is README:837
  (RM10 above).

## 8. Proposed edits, pending approval

Counted by file: README.md 19 rows (RM1–RM10, RM13–RM21), HANDOFF.md 6 rows (HH1–HH6),
REFACTOR_SMOKE_TEST.md 1 row (SM1). Report-only rows: RM11, RM12 (Q8 credentials), HH7.
Nothing is edited until the owner approves this list; the edits will then be wording-only in
`README.md` and `docs/`, in a separate commit (`p1d cp2b`).
