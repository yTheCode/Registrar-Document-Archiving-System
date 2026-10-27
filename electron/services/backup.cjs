// Backup/restore support helpers shared by the archive and backup handlers.
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');
const { dbDir, PROJECT_ROOT, DEFAULT_ARCHIVE_ROOT } = require('../paths.cjs');
const { resolveArchiveRoot } = require('../security/archiveRoot.cjs');

// Restoring reads the archive location out of a database that may have come
// from another machine, then deletes that folder recursively — so never let it
// name a path that could not legitimately be an archive root.
function isSafeArchiveTarget(dir) {
  const resolved = path.resolve(dir);
  const forbidden = [
    path.parse(resolved).root,
    app.getPath('home'),
    app.getPath('desktop'),
    app.getPath('documents'),
    app.getPath('userData'),
    dbDir,
    PROJECT_ROOT
  ];
  return !forbidden.some((p) => path.resolve(p) === resolved);
}

// Same rule as the live database, applied to whichever handle is passed in:
// the live one for backup:create, the backup's own database for restore.
function resolveArchiveDir(handle) {
  const row = handle.prepare('SELECT value FROM settings WHERE key = ?').get('archive_directory');
  return resolveArchiveRoot(row?.value, DEFAULT_ARCHIVE_ROOT);
}

// Prove the database inside a backup is a usable SQLite file with the tables
// this app needs, and report where it expects documents to live. Called before
// anything on disk is touched so a bad ZIP cannot destroy real data.
function inspectBackupDatabase(filePath) {
  let probe;
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true });

    const integrity = probe.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`integrity_check reported "${integrity}"`);
    }

    const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    const missing = ['users', 'students', 'documents', 'document_types', 'settings'].filter((t) => !tables.includes(t));
    if (missing.length > 0) {
      throw new Error(`missing required table(s): ${missing.join(', ')}`);
    }

    return resolveArchiveDir(probe);
  } catch (error) {
    throw new Error(`Invalid backup — ${error.message}`);
  } finally {
    if (probe) {
      probe.close();
    }
  }
}

function removeDatabaseSidecars(targetPath) {
  // Journal/WAL files belong to the database being replaced; leaving them
  // beside a new file would roll the replacement back or corrupt it.
  for (const suffix of ['-journal', '-wal', '-shm']) {
    fs.rmSync(targetPath + suffix, { force: true });
  }
}

module.exports = { isSafeArchiveTarget, resolveArchiveDir, inspectBackupDatabase, removeDatabaseSidecars };
