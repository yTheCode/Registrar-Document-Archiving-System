// Pure picked-file matching. No electron and no paths.cjs: the picked set and
// the host platform are injected, so this module loads in plain Node/Vitest.
const nodePath = require('path');

// Membership is path identity, not string identity: resolve to an absolute
// path, normalise separators, and fold case on Windows only (where the
// filesystem is case-insensitive). Only an absolute path (drive-letter or UNC)
// is considered, so the answer never depends on the process working
// directory. Returns null for anything that cannot be a path — null,
// non-strings, empty or whitespace-only, embedded NUL, relative — so a
// malformed argument never matches a picked file.
function normalizePickedPath(value, { platform = process.platform } = {}) {
  if (typeof value !== 'string' || value.includes('\0')) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const pathApi = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  if (!pathApi.isAbsolute(trimmed)) return null;

  let resolved;
  try {
    resolved = pathApi.resolve(trimmed);
  } catch {
    return null;
  }
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

// True only when sourcePath is the same file as one of the picked paths.
function isPickedPath(sourcePath, pickedPaths, options = {}) {
  const target = normalizePickedPath(sourcePath, options);
  if (!target) return false;
  if (!pickedPaths) return false;

  for (const picked of pickedPaths) {
    if (normalizePickedPath(picked, options) === target) return true;
  }
  return false;
}

module.exports = { normalizePickedPath, isPickedPath };
