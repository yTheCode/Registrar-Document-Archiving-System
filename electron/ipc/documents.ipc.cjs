// documents:* handlers, including documents:createBatch (moved verbatim from main.cjs in phase 1b).
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/connection.cjs');
const { isAdmin } = require('../services/authz.cjs');
const { buildStudentSearchFilter } = require('../services/studentQueries.cjs');
const { resolveArchivePath, toArchiveRelative } = require('../services/archivePaths.cjs');
const { PROGRAM_FOLDERS, computeDocumentTypeFolder, pickCollisionFreeFileName } = require('../services/folderNaming.cjs');


// Documents
ipcMain.handle('documents:delete', async (event, { id, userId }) => {
  try {
    // Check if user is admin
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    // Get document info for logging
    const doc = getDb().prepare('SELECT file_name, deleted_at FROM documents WHERE id = ?').get(id);

    if (!doc) {
      return { success: false, error: 'Document not found' };
    }

    if (doc.deleted_at) {
      // Already in the recycle bin
      return { success: true };
    }

    // Soft-delete: set deleted_at timestamp, preserving the database record and physical file
    getDb().prepare("UPDATE documents SET deleted_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?").run(id);

    // Log activity
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'document_deleted', 'document', id, `Soft-deleted document: ${doc.file_name}`);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Recycle bin: list soft-deleted documents (admin only)
ipcMain.handle('documents:getDeleted', async (event, opts = {}) => {
  try {
    const userId = opts.userId;
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    // Count total deleted documents
    const totalResult = getDb().prepare(`
      SELECT COUNT(*) AS count
      FROM documents d
      WHERE d.deleted_at IS NOT NULL
    `).get();
    const total = totalResult.count;

    // Determine pagination and sorting
    const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : total;
    const offset = Number.isFinite(opts.offset) && opts.offset > 0 ? Math.floor(opts.offset) : 0;
    const sortDir = String(opts.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Fetch deleted documents with student and document type info
    const documents = getDb().prepare(`
      SELECT 
        d.*,
        s.student_id AS student_number,
        s.first_name,
        s.last_name,
        s.middle_name,
        s.school_year,
        s.program_level,
        dt.name as document_type,
        COALESCE(d.created_by_name, u.username, 'Deleted User') as created_by_name
      FROM documents d
      LEFT JOIN students s ON d.student_id = s.id
      JOIN document_types dt ON d.document_type_id = dt.id
      LEFT JOIN users u ON d.created_by = u.id
      WHERE d.deleted_at IS NOT NULL
      ORDER BY d.deleted_at ${sortDir}
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    return { success: true, documents, total };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Recycle bin: restore a soft-deleted document (admin only)
ipcMain.handle('documents:restore', async (event, id, userId) => {
  try {
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    const doc = getDb().prepare('SELECT id, file_name, deleted_at FROM documents WHERE id = ?').get(id);
    if (!doc) {
      return { success: false, error: 'Document not found.' };
    }
    if (!doc.deleted_at) {
      return { success: false, error: 'This document is not in the recycle bin.' };
    }

    // Restore: clear deleted_at timestamp
    getDb().prepare("UPDATE documents SET deleted_at = NULL WHERE id = ?").run(id);

    // Log activity
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'document_restored', 'document', id, `Restored document: ${doc.file_name}`);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Recycle bin: permanently purge a soft-deleted document (admin only)
ipcMain.handle('documents:purge', async (event, id, userId) => {
  try {
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    const doc = getDb().prepare('SELECT id, file_name, file_path, deleted_at FROM documents WHERE id = ?').get(id);
    if (!doc) {
      return { success: false, error: 'Document not found.' };
    }
    if (!doc.deleted_at) {
      return { success: false, error: 'Only soft-deleted documents can be permanently purged.' };
    }

    // Resolve and validate the physical file path
    const resolvedPath = resolveArchivePath(doc.file_path);
    let fileDeleted = false;

    if (resolvedPath) {
      // Only delete the file if it exists and is within the archive directory
      if (fs.existsSync(resolvedPath)) {
        try {
          // Safety check: ensure the path is a file (not a directory)
          const stats = fs.statSync(resolvedPath);
          if (stats.isFile()) {
            fs.unlinkSync(resolvedPath);
            fileDeleted = true;
          } else {
            console.warn(`Cannot purge document ${id}: path is not a file: ${resolvedPath}`);
          }
        } catch (fileError) {
          console.warn(`Failed to delete physical file for document ${id}: ${fileError.message}`);
          // Continue with database deletion even if file deletion fails
        }
      }
    } else {
      console.warn(`Document ${id} has invalid path (outside archive): ${doc.file_path}`);
    }

    // Delete database record
    getDb().prepare('DELETE FROM documents WHERE id = ?').run(id);

    // Log activity
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'document_purged', 'document', id, 
           `Permanently deleted document: ${doc.file_name}${fileDeleted ? ' (file removed)' : ' (database only)'}`);

    return { success: true, fileDeleted };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('documents:update', async (event, { id, userId, documentTypeId, studentId, academicYear, remarks }) => {
  try {
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    const doc = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!doc) {
      return { success: false, error: 'Document not found' };
    }

    const newTypeId = documentTypeId ?? doc.document_type_id;
    const newStudentId = studentId === undefined ? doc.student_id : studentId;

    const type = getDb().prepare('SELECT id, name FROM document_types WHERE id = ?').get(newTypeId);
    if (!type) {
      return { success: false, error: 'Document type not found' };
    }

    if (newStudentId) {
      const student = getDb().prepare('SELECT first_name, last_name, program_level, school_year FROM students WHERE id = ?').get(newStudentId);
      if (!student) {
        return { success: false, error: 'Student not found' };
      }
      if (!student.program_level || !student.school_year || !PROGRAM_FOLDERS[student.program_level]) {
        return { success: false, error: `${student.first_name} ${student.last_name} needs a valid Program Level and School Year before documents can be filed under them.` };
      }
    }

    // Merge the editable keys into the existing metadata object so dynamic
    // per-type fields recorded at scan time are preserved.
    let metadataJson = doc.metadata_json;
    if (academicYear !== undefined || remarks !== undefined) {
      let parsed = {};
      try {
        parsed = doc.metadata_json ? JSON.parse(doc.metadata_json) : {};
      } catch {
        parsed = {};
      }
      if (academicYear !== undefined) parsed.academic_year = academicYear;
      if (remarks !== undefined) parsed.remarks = remarks;
      metadataJson = JSON.stringify(parsed);
    }

    const before = `type=${doc.document_type_id}, student=${doc.student_id ?? 'general'}, name=${doc.file_name}`;
    const locationChanged = newTypeId !== doc.document_type_id || newStudentId !== doc.student_id;

    // Metadata-only edit: no filesystem work.
    if (!locationChanged) {
      getDb().prepare('UPDATE documents SET metadata_json = ?, updated_at = (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')) WHERE id = ?')
        .run(metadataJson, id);
      getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
        .run(userId, 'document_updated', 'document', id, `Updated document (metadata): ${doc.file_name}`);
      return { success: true, fileName: doc.file_name };
    }

    const oldResolved = resolveArchivePath(doc.file_path);
    if (!oldResolved || !fs.existsSync(oldResolved)) {
      return { success: false, error: 'Original file not found in the archive' };
    }

    const folderResult = computeDocumentTypeFolder({ studentId: newStudentId, documentTypeName: type.name });
    if (!folderResult.ok) {
      return { success: false, error: folderResult.error };
    }
    const newFolder = folderResult.folderPath;

    // The file takes the target type's name in its new folder, with the "(n)"
    // collision suffix if something already occupies the plain name.
    const oldExt = path.extname(doc.file_name);
    const finalName = pickCollisionFreeFileName(newFolder, type.name, oldExt);
    const newAbsolute = path.join(newFolder, finalName);

    // Move the file first, then update the row; roll the move back if the
    // write fails so the two never disagree.
    fs.renameSync(oldResolved, newAbsolute);
    try {
      getDb().prepare('UPDATE documents SET document_type_id = ?, student_id = ?, metadata_json = ?, file_name = ?, file_path = ?, updated_at = (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')) WHERE id = ?')
        .run(newTypeId, newStudentId, metadataJson, finalName, toArchiveRelative(newAbsolute), id);
    } catch (dbError) {
      fs.renameSync(newAbsolute, oldResolved);
      throw dbError;
    }

    // Clean up the vacated type folder, but never the student/program/letter
    // folders above it.
    try {
      const oldTypeFolder = path.dirname(oldResolved);
      if (path.resolve(oldTypeFolder) !== path.resolve(newFolder) && fs.readdirSync(oldTypeFolder).length === 0) {
        fs.rmdirSync(oldTypeFolder);
      }
    } catch {
      // Folder cleanup is best-effort.
    }

    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'document_updated', 'document', id, `Updated document: ${before} -> type=${newTypeId}, student=${newStudentId ?? 'general'}, name=${finalName}`);

    return { success: true, fileName: finalName };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('documents:search', async (event, filters = {}) => {
  try {
    const where = ['d.deleted_at IS NULL']; // Exclude soft-deleted documents
    const params = [];

    if (filters.studentName) {
      const { clause, params: nameParams } = buildStudentSearchFilter(filters.studentName, 's');
      if (clause) {
        where.push(clause);
        params.push(...nameParams);
      }
    }

    if (filters.studentId) {
      where.push(`d.student_id = ?`);
      params.push(filters.studentId);
    }

    if (filters.documentType) {
      where.push(`d.document_type_id = ?`);
      params.push(filters.documentType);
    }

    if (filters.year) {
      where.push(`COALESCE(doc_academic_year(d.metadata_json), s.school_year) LIKE ?`);
      params.push(`%${filters.year}%`);
    }

    // Users LEFT join: accounts are hard-deleted, and a document must stay
    // searchable after its creator's account is gone.
    const fromSql = `
      FROM documents d
      LEFT JOIN students s ON d.student_id = s.id
      JOIN document_types dt ON d.document_type_id = dt.id
      LEFT JOIN users u ON d.created_by = u.id
      WHERE ${where.join(' AND ')}
    `;

    // Total matching rows (independent of paging) so the UI can show
    // "Showing X–Y of Z" and render correct page controls.
    const total = getDb().prepare(`SELECT COUNT(*) AS count ${fromSql}`).get(...params).count;

    // Whitelisted sort columns — never interpolate a raw client string into SQL.
    const sortColumns = {
      created_at: 'd.created_at',
      document_type: 'dt.name',
      file_name: 'd.file_name',
      student: 's.last_name'
    };
    const sortCol = sortColumns[filters.sortBy] || 'd.created_at';
    const sortDir = String(filters.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    let query = `
      SELECT 
        d.*,
        s.student_id AS student_number, s.first_name, s.last_name, s.middle_name,
        s.school_year, s.program_level,
        dt.name as document_type,
        COALESCE(d.created_by_name, u.username, 'Deleted User') as created_by_name
      ${fromSql}
      ORDER BY ${sortCol} ${sortDir}
    `;

    // Pagination is opt-in: callers that omit `limit` (e.g. the per-student
    // folder view) still receive the full result set.
    if (Number.isFinite(filters.limit) && filters.limit > 0) {
      query += ` LIMIT ? OFFSET ?`;
      params.push(Math.max(1, Math.floor(filters.limit)), Math.max(0, Math.floor(filters.offset || 0)));
    }

    const documents = getDb().prepare(query).all(...params);

    // Log any documents with broken student links
    const documentsWithBrokenLinks = documents.filter(doc => doc.student_id && !doc.first_name);
    if (documentsWithBrokenLinks.length > 0) {
      console.warn(`Found ${documentsWithBrokenLinks.length} document(s) with broken student links:`, 
        documentsWithBrokenLinks.map(doc => ({ id: doc.id, file_name: doc.file_name, student_id: doc.student_id })));
    }

    return { success: true, documents, total };
  } catch (error) {
    return { success: false, error: error.message };
  }
});


// ==================== BATCH OPERATIONS ====================

ipcMain.handle('documents:createBatch', async (event, { documents, userId }) => {
  try {
    // Check if user is admin
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    // The name is stamped per row so the credit survives the account's
    // permanent deletion later on.
    const actor = getDb().prepare('SELECT username FROM users WHERE id = ?').get(userId);

    const insertStmt = getDb().prepare(`
      INSERT INTO documents (student_id, document_type_id, file_name, file_path, metadata_json, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const createdIds = [];
    for (const doc of documents) {
      try {
        // Store archive-relative paths: the archive folder can then be moved
        // or re-pointed without rewriting rows (legacy absolute rows are
        // still readable via resolveArchivePath)
        const relativePath = toArchiveRelative(doc.file_path);
        if (!relativePath) {
          return { success: false, error: `Destination for "${doc.file_name}" is outside the archive directory.` };
        }
        const result = insertStmt.run(
          doc.student_id || null,
          doc.document_type_id,
          doc.file_name,
          relativePath,
          JSON.stringify(doc.metadata || {}),
          userId,
          actor?.username || 'Deleted User'
        );
        createdIds.push(result.lastInsertRowid);
      } catch (docError) {
        console.error('Failed to insert document:', doc);
        console.error('Error:', docError.message);
        throw docError;
      }
    }

    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'batch_documents_created', 'document', `Created ${documents.length} documents`);

    return { success: true, ids: createdIds, count: documents.length };
  } catch (error) {
    console.error('Batch creation error:', error.message);
    return { success: false, error: error.message };
  }
});
