// Archive-path validation and resolution. getDb() is called at use time,
// never captured at require time.
const path = require('path');
const { app } = require('electron');
const { getDb } = require('../db/connection.cjs');

// Helper function to validate and resolve file paths safely
function validateAndResolvePath(filePath, archiveRoot) {
  try {
    // Resolve to absolute paths
    const resolvedPath = path.resolve(filePath);
    const resolvedRoot = path.resolve(archiveRoot || app.getPath('documents'));
    
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

function getArchiveRoot() {
  const archiveSetting = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('archive_directory');
  return archiveSetting?.value || path.join(app.getPath('documents'), 'ADZU_Archive');
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

module.exports = { validateAndResolvePath, getArchiveRoot, resolveArchivePath, toArchiveRelative };
