// Startup data migrations for the archive tree (invoked from main.cjs
// right after initializeDatabase).
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { getDb } = require('../db/connection.cjs');
const { resolveArchivePath, toArchiveRelative } = require('./archivePaths.cjs');
const { PROGRAM_FOLDERS, buildStudentFolderName, sanitizeFolderName } = require('./folderNaming.cjs');

// Startup migration: every student document must live inside its
// document-type folder (see folders:generatePath). Older archives stored the
// first file of a type flat in the student directory — move those into
// <StudentDir>/<DocumentType>/ here and update the database to match.
function migrateDocumentTypeFolders() {
  try {
    const archiveSetting = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('archive_directory');
    const archiveRoot = archiveSetting?.value || path.join(app.getPath('documents'), 'ADZU_Archive');

    const docs = getDb().prepare(`
      SELECT d.id, d.file_name, d.file_path, d.student_id,
             s.first_name, s.last_name, s.middle_name, s.school_year, s.program_level,
             dt.name AS document_type_name
      FROM documents d
      JOIN students s ON d.student_id = s.id
      JOIN document_types dt ON d.document_type_id = dt.id
      WHERE d.student_id IS NOT NULL
      ORDER BY d.id
    `).all();

    let moved = 0;
    let skipped = 0;

    for (const doc of docs) {
      try {
        const programFolder = PROGRAM_FOLDERS[doc.program_level];
        if (!programFolder || !doc.school_year) {
          skipped++;
          continue;
        }

        const letter = (doc.last_name.trim()[0] || '#').toUpperCase();
        const studentDir = path.join(archiveRoot, programFolder, letter, buildStudentFolderName(doc));
        const typeDir = path.join(studentDir, sanitizeFolderName(doc.document_type_name));

        const currentPath = resolveArchivePath(doc.file_path);
        if (!currentPath) {
          skipped++; // stored path escapes the archive root — leave it alone
          continue;
        }
        const currentDir = path.dirname(currentPath);
        if (currentDir === typeDir) continue; // already organized
        if (currentDir !== studentDir || !fs.existsSync(currentPath)) {
          skipped++; // unexpected location or missing file — leave it alone
          continue;
        }

        fs.mkdirSync(typeDir, { recursive: true });
        const extMatch = doc.file_name.match(/\.([a-zA-Z0-9]+)$/);
        const ext = extMatch ? extMatch[1] : 'dat';
        let fileName = `${doc.document_type_name}.${ext}`;
        let n = 1;
        while (fs.existsSync(path.join(typeDir, fileName))) {
          fileName = `${doc.document_type_name} (${n}).${ext}`;
          n++;
        }
        const newPath = path.join(typeDir, fileName);
        fs.renameSync(currentPath, newPath);
        getDb().prepare('UPDATE documents SET file_name = ?, file_path = ?, updated_at = (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')) WHERE id = ?')
          .run(fileName, toArchiveRelative(newPath), doc.id);
        moved++;
      } catch (docErr) {
        console.warn(`Document folder migration: skipped document ${doc.id} (${doc.file_name}): ${docErr.message}`);
        skipped++;
      }
    }

    if (moved > 0 || skipped > 0) {
      console.log(`Document-type folder migration finished: ${moved} moved into document-type folders, ${skipped} left in place.`);
    }
  } catch (error) {
    console.error('Document-type folder migration failed:', error);
  }
}

// Startup migration: documents.file_path used to store absolute paths. Rows
// still in that form are rewritten relative to the archive root (the readers
// resolve either form, so this is a storage-format cleanup, not a fix for
// broken links). Rows pointing outside the current root are left alone —
// they become readable again if the root is re-pointed at their location.
function migrateToRelativePaths() {
  try {
    const docs = getDb().prepare('SELECT id, file_path FROM documents').all();
    let converted = 0;
    for (const doc of docs) {
      if (!doc.file_path || !path.isAbsolute(doc.file_path)) continue;
      const relative = toArchiveRelative(doc.file_path);
      if (!relative) continue;
      getDb().prepare('UPDATE documents SET file_path = ? WHERE id = ?').run(relative, doc.id);
      converted++;
    }
    if (converted > 0) {
      console.log(`Relative-path migration finished: ${converted} document path(s) rewritten archive-relative.`);
    }
  } catch (error) {
    console.error('Relative-path migration failed:', error);
  }
}

module.exports = { migrateDocumentTypeFolders, migrateToRelativePaths };
