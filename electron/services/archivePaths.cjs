// Archive-path validation and resolution. getDb() is called at use time,
// never captured at require time.
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/connection.cjs');
const { DEFAULT_ARCHIVE_ROOT } = require('../paths.cjs');
const { resolveArchiveRoot } = require('../security/archiveRoot.cjs');

// Helper function to validate and resolve file paths safely
function validateAndResolvePath(filePath, archiveRoot) {
  try {
    // Resolve to absolute paths
    const resolvedPath = path.resolve(filePath);
    const configuredRoot = resolveArchiveRoot(archiveRoot, null);
    const resolvedRoot = path.resolve(configuredRoot || getArchiveRoot());
    
    // Check if the resolved path is within the archive root
    const relativePath = path.relative(resolvedRoot, resolvedPath);
    
    // If relativePath starts with '..' or is absolute, it's outside the root
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return { valid: false, error: 'Path is outside archive directory' };
    }
    
    return { valid: true, resolvedPath, resolvedRoot };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

function readArchiveSetting(handle) {
  return handle.prepare('SELECT value FROM settings WHERE key = ?').get('archive_directory')?.value;
}

// Q11: the single archive root. The stored value wins when it has content;
// a missing or blank row falls back to DEFAULT_ARCHIVE_ROOT, the same default
// the database, backups and imports all use.
function getArchiveRoot(handle) {
  return resolveArchiveRoot(readArchiveSetting(handle || getDb()), DEFAULT_ARCHIVE_ROOT);
}

// Write the shared default when the row is missing or blank, so that from then
// on every consumer reads the same value instead of guessing, and make sure
// that default folder exists. A configured custom root is never rewritten and
// never created here (its location is the user's business, and it may be a
// network path that is not mounted right now).
function ensureArchiveSetting(handle) {
  const h = handle || getDb();
  const value = readArchiveSetting(h);
  const root = resolveArchiveRoot(value, DEFAULT_ARCHIVE_ROOT);

  if (typeof value !== 'string' || !value.trim()) {
    h.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('archive_directory', ?, (strftime('%Y-%m-%dT%H:%M:%fZ','now')))
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    `).run(root, root);
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
  }

  return root;
}

// Stored document paths may be legacy absolute paths or archive-relative
// paths (the current format). Resolve either form against the current
// archive root; return null when the result would escape the root.
function resolveArchivePath(storedPath) {
  if (!storedPath || typeof storedPath !== 'string') return null;
  const root = path.resolve(getArchiveRoot());
  const resolved = path.isAbsolute(storedPath)
    ? path.resolve(storedPath)
    : path.resolve(root, storedPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

// Inverse of resolveArchivePath for new writes: every path stored in the
// database is kept relative to the archive root so the archive folder can be
// moved or re-pointed without rewriting rows.
function toArchiveRelative(absolutePath) {
  const root = path.resolve(getArchiveRoot());
  const relative = path.relative(root, path.resolve(absolutePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}

module.exports = { validateAndResolvePath, getArchiveRoot, ensureArchiveSetting, resolveArchivePath, toArchiveRelative };
