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

- (none collected yet; this section will be appended to as phases progress)
