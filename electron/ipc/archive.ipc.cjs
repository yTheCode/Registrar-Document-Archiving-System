// archive:* handlers (purgeAll, changeDirectory, checkIntegrity) (moved verbatim from main.cjs in phase 1b).
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection.cjs');
const { isAdmin } = require('../services/authz.cjs');
const { getArchiveRoot, resolveArchivePath } = require('../services/archivePaths.cjs');
const { isSafeArchiveTarget } = require('../services/backup.cjs');


// ==================== ADMINISTRATOR ARCHIVE PURGE ====================

/**
 * Purge Archive - Administrator-only operation to completely clear the archive
 * for final system submission. Removes all student records, document metadata,
 * activity logs and physical archived files while preserving the accounts and
 * system configuration. Requires the acting administrator's password, which is
 * re-checked here rather than trusted from the renderer.
 * 
 * IMPORTANT: This operation is DESTRUCTIVE and IRREVERSIBLE.
 * The entire archive will be emptied. Use ONLY for final submission preparation.
 */
ipcMain.handle('archive:purgeAll', async (event, { userId, password }) => {
  try {
    // Strict admin-only check
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Archive purge requires Administrator access.' };
    }

    // Re-verify the password here, not just in the dialog, so a purge can never
    // be replayed without the administrator's credentials.
    const account = getDb().prepare('SELECT password_hash, status FROM users WHERE id = ?').get(userId);
    if (!account || account.status !== 'active') {
      return { success: false, error: 'This account is not available for a purge.' };
    }
    if (!bcrypt.compareSync(String(password ?? ''), account.password_hash)) {
      return { success: false, error: 'Incorrect administrator password. Nothing was deleted.' };
    }

    const archiveRoot = getArchiveRoot();
    const results = {
      studentsDeleted: 0,
      documentsDeleted: 0,
      filesDeleted: 0,
      logsDeleted: 0,
      fileErrors: [],
      errors: []
    };

    // Step 1: Get counts before deletion
    const studentCount = getDb().prepare('SELECT COUNT(*) AS count FROM students').get().count;
    const documentCount = getDb().prepare('SELECT COUNT(*) AS count FROM documents').get().count;
    const logCount = getDb().prepare('SELECT COUNT(*) AS count FROM activity_logs').get().count;

    // Step 2: Get all document file paths for physical deletion
    const documents = getDb().prepare('SELECT id, file_path, file_name FROM documents').all();

    // Step 3: Delete database records first (transactions don't cover filesystem)
    try {
      getDb().exec('BEGIN TRANSACTION');
      
      // Delete all documents (cascades will not affect students due to FK design)
      getDb().prepare('DELETE FROM documents').run();
      results.documentsDeleted = documentCount;

      // Delete all students (both active and soft-deleted)
      getDb().prepare('DELETE FROM students').run();
      results.studentsDeleted = studentCount;

      // Wipe the activity log too: the purge is a final-submission reset, so
      // the audit trail of the emptied archive goes with it. The purge itself
      // is written back after the commit as the only remaining entry.
      getDb().prepare('DELETE FROM activity_logs').run();
      results.logsDeleted = logCount;

      getDb().exec('COMMIT');
    } catch (dbError) {
      getDb().exec('ROLLBACK');
      return { success: false, error: `Database purge failed: ${dbError.message}` };
    }

    // Step 4: Delete physical archive files
    // Note: Filesystem operations cannot be rolled back, so DB deletion happens first
    // If file deletion fails, DB is already cleared but files remain (safer than opposite)
    for (const doc of documents) {
      try {
        const resolvedPath = resolveArchivePath(doc.file_path);
        if (resolvedPath && fs.existsSync(resolvedPath)) {
          const stats = fs.statSync(resolvedPath);
          if (stats.isFile()) {
            fs.unlinkSync(resolvedPath);
            results.filesDeleted++;
          }
        }
      } catch (fileError) {
        results.fileErrors.push({
          file: doc.file_name,
          error: fileError.message
        });
      }
    }

    // Step 5: Clean up empty directories in archive
    try {
      const programFolders = ['College Student Records', 'Graduate Student Records', 'Medical Student Records', 'Law Student Records', 'General Documents'];
      for (const folder of programFolders) {
        const folderPath = path.join(archiveRoot, folder);
        if (fs.existsSync(folderPath)) {
          // Remove empty subdirectories recursively
          removeEmptyDirectoriesRecursive(folderPath);
        }
      }
    } catch (cleanupError) {
      results.errors.push(`Directory cleanup warning: ${cleanupError.message}`);
    }

    // Record the purge itself — written after the wipe so it survives as the
    // only entry left in the audit trail
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'archive_purged', 'system',
           `Archive purged: ${results.studentsDeleted} students, ${results.documentsDeleted} documents, ${results.filesDeleted} files, ${results.logsDeleted} log entries deleted`);

    return {
      success: true,
      deletedStudents: results.studentsDeleted,
      deletedDocuments: results.documentsDeleted,
      deletedFiles: results.filesDeleted,
      deletedLogs: results.logsDeleted,
      fileErrors: results.fileErrors,
      message: `Archive purged successfully. ${results.studentsDeleted} student records and ${results.documentsDeleted} documents removed.`
    };
  } catch (error) {
    return { success: false, error: `Archive purge failed: ${error.message}` };
  }
});

/**
 * Recursively remove empty directories, preserving the root structure
 */
function removeEmptyDirectoriesRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  // Recursively clean subdirectories first
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const fullPath = path.join(dirPath, entry.name);
      removeEmptyDirectoriesRecursive(fullPath);
    }
  }
  
  // After cleaning subdirectories, check if this directory is now empty
  const remainingEntries = fs.readdirSync(dirPath);
  if (remainingEntries.length === 0) {
    // Don't delete the program folder roots themselves, only their contents
    const archiveRoot = getArchiveRoot();
    const relativePath = path.relative(archiveRoot, dirPath);
    const isTopLevelFolder = !relativePath.includes(path.sep) || relativePath === 'General Documents';
    
    if (!isTopLevelFolder) {
      fs.rmdirSync(dirPath);
    }
  }
}


// ==================== ARCHIVE LOCATION ====================

// Relocating the archive. mode 'move' copies the whole tree to the new root,
// verifies every copied file, and only then deletes the source — a failed
// verification leaves the original archive untouched. mode 'point' only
// updates the setting, for archives that were relocated outside the app.
ipcMain.handle('archive:changeDirectory', async (event, { newRoot, mode, userId }) => {
  try {
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }
    if (!newRoot || typeof newRoot !== 'string') {
      return { success: false, error: 'A new archive directory is required.' };
    }
    if (mode !== 'move' && mode !== 'point') {
      return { success: false, error: 'Mode must be "move" or "point".' };
    }

    const oldRoot = path.resolve(getArchiveRoot());
    const target = path.resolve(newRoot);
    if (target === oldRoot) {
      return { success: false, error: 'The selected folder is already the archive directory.' };
    }
    if (!isSafeArchiveTarget(target)) {
      return { success: false, error: 'That location is not allowed as an archive directory.' };
    }
    // Refuse nesting in either direction: a move would copy the archive into
    // itself, and a point would leave every stored path unresolvable.
    const forward = path.relative(oldRoot, target);
    const backward = path.relative(target, oldRoot);
    if (!forward.startsWith('..') && !path.isAbsolute(forward)) {
      return { success: false, error: 'The new directory cannot be inside the current archive directory.' };
    }
    if (!backward.startsWith('..') && !path.isAbsolute(backward)) {
      return { success: false, error: 'The new directory cannot contain the current archive directory.' };
    }

    let movedFiles = 0;
    if (mode === 'move') {
      if (!fs.existsSync(oldRoot)) {
        return { success: false, error: 'The current archive directory does not exist.' };
      }
      // Merging into a folder that already has content risks mixing two
      // archives; only a non-existent or empty destination is accepted
      if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
        return { success: false, error: 'The destination folder is not empty.' };
      }

      fs.cpSync(oldRoot, target, { recursive: true });

      const mismatches = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const src = path.join(dir, entry.name);
          const dst = path.join(target, path.relative(oldRoot, src));
          if (entry.isDirectory()) {
            walk(src);
          } else if (entry.isFile()) {
            if (!fs.existsSync(dst) || fs.statSync(src).size !== fs.statSync(dst).size) {
              mismatches.push(path.relative(oldRoot, src));
            } else {
              movedFiles++;
            }
          }
        }
      };
      walk(oldRoot);

      if (mismatches.length > 0) {
        // Verification failed — remove the partial copy, keep the source
        fs.rmSync(target, { recursive: true, force: true });
        return {
          success: false,
          error: `Copy verification failed for ${mismatches.length} file(s) (first: "${mismatches[0]}"). The original archive is unchanged.`
        };
      }
      fs.rmSync(oldRoot, { recursive: true, force: true });
    }

    getDb().prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('archive_directory', ?, (strftime('%Y-%m-%dT%H:%M:%fZ','now')))
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    `).run(target, target);

    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'archive_directory_changed', 'setting',
        mode === 'move'
          ? `Moved archive from ${oldRoot} to ${target} (${movedFiles} files verified)`
          : `Re-pointed archive directory to ${target} (files left in place)`);

    return { success: true, mode, movedFiles };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('archive:checkIntegrity', async (event, { userId }) => {
  try {
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    const docs = getDb().prepare('SELECT id, file_name, file_path FROM documents ORDER BY id').all();
    const missing = [];
    let present = 0;
    for (const doc of docs) {
      const resolved = resolveArchivePath(doc.file_path);
      if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        present++;
      } else {
        missing.push({ id: doc.id, file_name: doc.file_name, file_path: doc.file_path });
      }
    }

    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'archive_integrity_checked', 'archive', `Integrity check: ${present} of ${docs.length} files present`);

    return { success: true, total: docs.length, present, missing };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
