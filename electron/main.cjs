const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// paths.cjs must be required first: its import-time side effects (database
// folder creation, legacy database copy) previously ran here at module load.
const { userDataPath, dbDir, dbPath, ELECTRON_DIR, PROJECT_ROOT, PRELOAD_PATH } = require('./paths.cjs');
const { getMainWindow, setMainWindow } = require('./window.cjs');
const { getDb, setDb, initializeDatabase, closeDatabase, registerDbFunctions } = require('./db/connection.cjs');
const { runMigrations } = require('./db/migrations.cjs');


function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../src/assets/adzu-seal.png')
  });
  setMainWindow(mainWindow);

  // Load app
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  try {
    initializeDatabase();

    // Move any legacy flat-stored student documents into document-type folders
    migrateDocumentTypeFolders();

    // Rewrite legacy absolute document paths archive-relative
    migrateToRelativePaths();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    dialog.showErrorBox(
      'Database initialization failed',
      `The application could not open its database.\n\n` +
      `Path: ${dbPath}\n\n` +
      `Error: ${error && error.message ? error.message : String(error)}\n\n` +
      `If this mentions NODE_MODULE_VERSION, run "npm run rebuild" to recompile ` +
      `better-sqlite3 against this Electron version.`
    );
    app.quit();
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  closeDatabase();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDatabase();
    app.quit();
  }
});

// ==================== IPC HANDLERS ====================

// Helper function to check if user is admin
async function isAdmin(userId) {
  if (!userId) return false;
  const user = getDb().prepare('SELECT role FROM users WHERE id = ?').get(userId);
  return user && user.role === 'admin';
}

/**
 * Build a WHERE fragment for free-text student search, shared by
 * students:search and documents:search. The term is split on whitespace
 * (commas treated as separators) and every word must match (AND) at least one
 * of the student columns (OR). `tableAlias` is the table qualifier ('' for the
 * bare students table, 's' inside the documents join).
 */
function buildStudentSearchFilter(term, tableAlias = '') {
  const words = String(term).replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { clause: '', params: [] };

  const columns = ['first_name', 'middle_name', 'last_name', 'student_id', 'school_year', 'program_level'];
  const clause = words
    .map(() => `(${columns.map(col => `${tableAlias ? tableAlias + '.' : ''}${col} LIKE ?`).join(' OR ')})`)
    .join(' AND ');
  const params = words.flatMap(word => {
    const like = `%${word}%`;
    return columns.map(() => like);
  });
  return { clause, params };
}

// Authentication
ipcMain.handle('auth:login', async (event, { username, password }) => {
  try {
    const user = getDb().prepare("SELECT * FROM users WHERE username = ? AND status = 'active' AND deleted_at IS NULL").get(username);
    
    if (!user) {
      return { success: false, error: 'Invalid username or password' };
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
    
    if (!isPasswordValid) {
      return { success: false, error: 'Invalid username or password' };
    }

    // Log activity
    getDb().prepare('INSERT INTO activity_logs (user_id, action) VALUES (?, ?)')
      .run(user.id, 'login');

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Students
// Pagination + sorting are opt-in via `opts`; callers that omit them (e.g. the
// ImportScanner student dropdown, which searches client-side) get every row.
const STUDENT_SORT_COLUMNS = {
  last_name: 'last_name',
  first_name: 'first_name',
  school_year: 'school_year',
  program_level: 'program_level',
  created_at: 'created_at'
};

function buildStudentPage(options = {}) {
  const sortCol = STUDENT_SORT_COLUMNS[options.sortBy] || 'last_name';
  const sortDir = String(options.sortDir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const params = [];
  let tail = ` ORDER BY ${sortCol} ${sortDir}, first_name ASC`;
  if (Number.isFinite(options.limit) && options.limit > 0) {
    tail += ` LIMIT ? OFFSET ?`;
    params.push(Math.max(1, Math.floor(options.limit)), Math.max(0, Math.floor(options.offset || 0)));
  }
  return { tail, params };
}

/**
 * Build the WHERE fragment + params shared by students:getAll and
 * students:search. Soft-deleted rows are excluded unless options.deleted is set
 * (the recycle bin). Optional schoolYear / programLevel narrow the result, and
 * a free-text term is layered on through buildStudentSearchFilter.
 */
function buildStudentListWhere(options = {}, term = null) {
  const clauses = [options.deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const params = [];

  if (term !== null && String(term).trim()) {
    const { clause, params: termParams } = buildStudentSearchFilter(term);
    if (clause) {
      clauses.push(clause);
      params.push(...termParams);
    }
  }
  if (options.schoolYear) {
    clauses.push('school_year = ?');
    params.push(options.schoolYear);
  }
  if (options.programLevel) {
    clauses.push('program_level = ?');
    params.push(options.programLevel);
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

ipcMain.handle('students:getAll', async (event, opts = {}) => {
  try {
    const { where, params } = buildStudentListWhere(opts);
    const total = getDb().prepare(`SELECT COUNT(*) AS count FROM students ${where}`).get(...params).count;
    const { tail, params: pageParams } = buildStudentPage(opts);
    const students = getDb().prepare(`SELECT * FROM students ${where}${tail}`).all(...params, ...pageParams);
    return { success: true, students, total };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('students:search', async (event, searchTerm, opts = {}) => {
  try {
    const { where, params } = buildStudentListWhere(opts, searchTerm);
    const total = getDb().prepare(`SELECT COUNT(*) AS count FROM students ${where}`).get(...params).count;
    const { tail, params: pageParams } = buildStudentPage(opts);
    const students = getDb().prepare(`SELECT * FROM students ${where}${tail}`).all(...params, ...pageParams);
    return { success: true, students, total };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Distinct filter values for the student directory's School Year / Program Level
// dropdowns (active records only). Program Level is merged with a canonical list
// in the UI so the standard options always appear.
ipcMain.handle('students:getFilterOptions', async () => {
  try {
    const schoolYears = getDb().prepare(
      "SELECT DISTINCT school_year AS value FROM students WHERE deleted_at IS NULL AND school_year IS NOT NULL AND school_year != '' ORDER BY school_year DESC"
    ).all().map(r => r.value);
    const programLevels = getDb().prepare(
      "SELECT DISTINCT program_level AS value FROM students WHERE deleted_at IS NULL AND program_level IS NOT NULL AND program_level != '' ORDER BY program_level ASC"
    ).all().map(r => r.value);
    return { success: true, schoolYears, programLevels };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('students:getById', async (event, id) => {
  try {
    const student = getDb().prepare('SELECT * FROM students WHERE id = ?').get(id);
    return { success: true, student };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('students:create', async (event, studentData, userId) => {
  try {
    // Check if user is admin
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    if (!studentData.first_name || !studentData.first_name.trim() || !studentData.last_name || !studentData.last_name.trim()) {
      return { success: false, error: 'First name and last name are required.' };
    }
    if (!studentData.school_year || !studentData.school_year.trim()) {
      return { success: false, error: 'School Year is required (e.g., 1996-1997).' };
    }
    if (!studentData.program_level || !studentData.program_level.trim()) {
      return { success: false, error: 'Program Level is required.' };
    }

    const studentId = studentData.student_id && studentData.student_id.trim() ? studentData.student_id.trim() : null;

    // Normalize names to uppercase
    const firstName = studentData.first_name.trim().toUpperCase();
    const lastName = studentData.last_name.trim().toUpperCase();
    const middleName = studentData.middle_name && studentData.middle_name.trim() 
      ? studentData.middle_name.trim().toUpperCase() 
      : null;

    // Hard error on duplicate student ID — a UNIQUE violation would otherwise
    // surface raw SQLite text to the user
    if (studentId) {
      const idClash = getDb().prepare('SELECT id, first_name, last_name FROM students WHERE student_id = ?').get(studentId);
      if (idClash) {
        return { success: false, error: `Student ID "${studentId}" is already assigned to ${idClash.first_name} ${idClash.last_name} (record #${idClash.id}).` };
      }
    }

    // Possible-duplicate detection; the client confirms "Add anyway?" and
    // resubmits with force: true to bypass this check
    if (!studentData.force) {
      const dup = getDb().prepare(`
        SELECT id, first_name, last_name, school_year, program_level FROM students
        WHERE UPPER(first_name) = UPPER(?)
          AND UPPER(COALESCE(middle_name, '')) = UPPER(?)
          AND UPPER(last_name) = UPPER(?)
          AND UPPER(COALESCE(school_year, '')) = UPPER(?)
          AND UPPER(COALESCE(program_level, '')) = UPPER(?)
      `).get(
        firstName,
        middleName || '',
        lastName,
        studentData.school_year.trim(),
        studentData.program_level.trim()
      );
      if (dup) {
        return {
          success: false,
          possibleDuplicate: true,
          error: `A student named ${dup.first_name} ${dup.last_name} already exists for ${dup.school_year} — ${dup.program_level} (record #${dup.id}).`
        };
      }
    }

    const result = getDb().prepare(`
      INSERT INTO students (student_id, first_name, last_name, middle_name, school_year, program_level)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      studentId,
      firstName,
      lastName,
      middleName,
      studentData.school_year.trim(),
      studentData.program_level.trim()
    );

    return { success: true, id: result.lastInsertRowid };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('students:update', async (event, { id, studentData, userId }) => {
  try {
    // Check if user is admin
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    if (!studentData.first_name || !studentData.first_name.trim() || !studentData.last_name || !studentData.last_name.trim()) {
      return { success: false, error: 'First name and last name are required.' };
    }
    if (!studentData.school_year || !studentData.school_year.trim()) {
      return { success: false, error: 'School Year is required (e.g., 1996-1997).' };
    }
    if (!studentData.program_level || !studentData.program_level.trim()) {
      return { success: false, error: 'Program Level is required.' };
    }

    const studentId = studentData.student_id && studentData.student_id.trim() ? studentData.student_id.trim() : null;

    // Normalize names to uppercase
    const firstName = studentData.first_name.trim().toUpperCase();
    const lastName = studentData.last_name.trim().toUpperCase();
    const middleName = studentData.middle_name && studentData.middle_name.trim() 
      ? studentData.middle_name.trim().toUpperCase() 
      : null;

    // Same friendly guard as students:create — a UNIQUE violation here would
    // otherwise surface raw SQLite text
    if (studentId) {
      const idClash = getDb().prepare('SELECT id, first_name, last_name FROM students WHERE student_id = ? AND id != ?').get(studentId, id);
      if (idClash) {
        return { success: false, error: `Student ID "${studentId}" is already assigned to ${idClash.first_name} ${idClash.last_name} (record #${idClash.id}).` };
      }
    }

    getDb().prepare(`
      UPDATE students
      SET student_id = ?, first_name = ?, last_name = ?, middle_name = ?, school_year = ?, program_level = ?
      WHERE id = ?
    `).run(
      studentId,
      firstName,
      lastName,
      middleName,
      studentData.school_year.trim(),
      studentData.program_level.trim(),
      id
    );

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('students:delete', async (event, id, userId) => {
  try {
    // Check if user is admin
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    const student = getDb().prepare('SELECT id, deleted_at FROM students WHERE id = ?').get(id);
    if (!student) {
      return { success: false, error: 'Student not found.' };
    }
    // Already in the recycle bin — nothing to do
    if (student.deleted_at) {
      return { success: true };
    }

    // Soft-delete into the recycle bin. The row and any linked documents stay
    // intact so the record can be restored later.
    getDb().prepare(
      "UPDATE students SET deleted_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?"
    ).run(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Recycle bin: list soft-deleted students (admin only)
ipcMain.handle('students:getDeleted', async (event, userId, options = {}) => {
  try {
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 50;
    const offset = Number.isFinite(options.offset) && options.offset > 0 ? Math.floor(options.offset) : 0;

    const total = getDb().prepare('SELECT COUNT(*) as count FROM students WHERE deleted_at IS NOT NULL').get().count;
    const students = getDb().prepare(
      'SELECT * FROM students WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);

    return { success: true, students, total };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Recycle bin: restore a soft-deleted student (admin only)
ipcMain.handle('students:restore', async (event, id, userId) => {
  try {
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }
    getDb().prepare(
      "UPDATE students SET deleted_at = NULL WHERE id = ?"
    ).run(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Recycle bin: permanently erase a soft-deleted student (admin only). Blocked
// while documents still reference the record, so no document is orphaned.
ipcMain.handle('students:purge', async (event, id, userId) => {
  try {
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }
    const docCount = getDb().prepare('SELECT COUNT(*) as count FROM documents WHERE student_id = ?').get(id);
    if (docCount.count > 0) {
      return { success: false, error: `Cannot permanently delete a student with ${docCount.count} document(s). Delete their documents first.` };
    }
    getDb().prepare('DELETE FROM students WHERE id = ?').run(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

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

// Document Types
ipcMain.handle('documentTypes:getAll', async () => {
  try {
    const types = getDb().prepare('SELECT * FROM document_types ORDER BY name').all();
    return { success: true, types };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('documentTypes:create', async (event, { name, userId }) => {
  try {
    // Check if user is admin
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    const result = getDb().prepare('INSERT INTO document_types (name) VALUES (?)').run(name);
    
    // Log activity
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'document_type_created', 'document_type', result.lastInsertRowid, `Created document type: ${name}`);

    return { success: true, id: result.lastInsertRowid };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('documentTypes:delete', async (event, { id, userId }) => {
  try {
    // Check if user is admin
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    // Check if any documents use this type
    const docCount = getDb().prepare('SELECT COUNT(*) as count FROM documents WHERE document_type_id = ?').get(id);
    if (docCount.count > 0) {
      return { success: false, error: `Cannot delete document type with ${docCount.count} document(s) using it.` };
    }

    getDb().prepare('DELETE FROM document_types WHERE id = ?').run(id);
    
    // Log activity
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'document_type_deleted', 'document_type', id, 'Deleted document type');

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// File operations
ipcMain.handle('file:copy', async (event, { sourcePath, destPath }) => {
  try {
    // Get archive root from settings
    const archiveSetting = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('archive_directory');
    const archiveRoot = archiveSetting?.value || path.join(app.getPath('documents'), 'ADZU_Archive');
    
    // Validate destination path to prevent traversal attacks
    const validation = validateAndResolvePath(destPath, archiveRoot);
    if (!validation.valid) {
      return { success: false, error: `Security: ${validation.error}` };
    }

    // Ensure destination directory exists
    const destDir = path.dirname(validation.resolvedPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Copy file
    fs.copyFileSync(sourcePath, validation.resolvedPath);
    return { success: true, filePath: validation.resolvedPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:openExternal', async (event, filePath) => {
  try {
    // Stored paths may be legacy absolute or archive-relative; resolution
    // enforces containment within the current archive root
    const resolvedPath = resolveArchivePath(filePath);
    if (!resolvedPath) {
      return { success: false, error: 'File path is outside archive directory' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found' };
    }

    const { shell } = require('electron');
    await shell.openPath(resolvedPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:showInFolder', async (event, filePath) => {
  try {
    // Stored paths may be legacy absolute or archive-relative; resolution
    // enforces containment within the current archive root
    const resolvedPath = resolveArchivePath(filePath);
    if (!resolvedPath) {
      return { success: false, error: 'File path is outside archive directory' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found' };
    }

    const { shell } = require('electron');
    shell.showItemInFolder(resolvedPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:readAsBase64', async (event, filePath) => {
  try {
    // Stored paths may be legacy absolute or archive-relative; resolution
    // enforces containment within the current archive root
    const resolvedPath = resolveArchivePath(filePath);
    if (!resolvedPath) {
      return { success: false, error: 'File path is outside archive directory' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found' };
    }

    const data = fs.readFileSync(resolvedPath);
    const base64 = data.toString('base64');
    const ext = path.extname(resolvedPath).toLowerCase();
    let mimeType = 'application/octet-stream';
    
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    
    mimeType = mimeTypes[ext] || mimeType;

    return { success: true, base64, mimeType };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Read a file the user explicitly picked THIS session (via the open-file dialog)
// as base64. Unlike file:readAsBase64 this does NOT enforce archive containment:
// pre-import uploads still live outside the archive and must be previewable and
// editable before they are copied in. Only image mime types are returned.
const sessionPickedFiles = new Set();

function isForbiddenPickedPath(resolved) {
  const forbidden = [dbDir, dbPath, ELECTRON_DIR];
  if (process.platform === 'win32') {
    forbidden.push(path.resolve(process.env.SystemRoot || 'C:\\Windows'));
  } else {
    forbidden.push('/etc', '/usr', '/bin', '/sbin', '/System');
  }
  return forbidden.some((fp) => {
    const abs = path.resolve(fp);
    return resolved === abs || resolved.startsWith(abs + path.sep);
  });
}

ipcMain.handle('file:readPickedAsBase64', async (event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' };
    }
    const resolved = path.resolve(filePath);

    if (isForbiddenPickedPath(resolved) || !sessionPickedFiles.has(resolved)) {
      return { success: false, error: 'Access to this location is not permitted' };
    }

    if (!fs.existsSync(resolved)) {
      return { success: false, error: 'File not found' };
    }
    const ext = path.extname(resolved).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif'
    };
    const mimeType = mimeTypes[ext];
    if (!mimeType) {
      return { success: false, error: 'Only image files can be edited' };
    }
    const base64 = fs.readFileSync(resolved).toString('base64');
    return { success: true, base64, mimeType };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Print a document. Images go through a hidden fit-to-page window with the
// system print dialog; PDFs and office formats open in the default app —
// Chromium's print pipeline can't rasterize the PDF plugin or office viewers.
ipcMain.handle('file:print', async (event, { filePath, userId }) => {
  const logPrint = (details) => {
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'document_printed', 'document', details);
  };

  try {
    // Stored paths may be legacy absolute or archive-relative; resolution
    // enforces containment within the current archive root
    const resolvedPath = resolveArchivePath(filePath);
    if (!resolvedPath) {
      return { success: false, error: 'File path is outside archive directory' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found' };
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const fileName = path.basename(resolvedPath);

    if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png' && ext !== '.gif') {
      const { shell } = require('electron');
      await shell.openPath(resolvedPath);
      logPrint(`Opened for print (external app): ${fileName}`);
      return { success: true, external: true };
    }

    // Image: hidden window with the image fit to one page
    const { pathToFileURL } = require('url');
    const htmlPath = path.join(app.getPath('temp'), `adzu-print-${Date.now()}.html`);
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: auto; margin: 12mm; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body { display: flex; align-items: center; justify-content: center; }
  img { max-width: 100%; max-height: 100vh; object-fit: contain; }
</style>
</head>
<body>
  <img src="${pathToFileURL(resolvedPath).href}" alt="">
</body>
</html>`;
    fs.writeFileSync(htmlPath, html);

    const printWindow = new BrowserWindow({
      show: false,
      width: 850,
      height: 1100,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        preload: PRELOAD_PATH
      }
    });

    try {
      await printWindow.loadFile(htmlPath);
      await new Promise((resolve, reject) => {
        printWindow.webContents.print(
          { silent: false, printBackground: true },
          (success, failureReason) => {
            if (!success && failureReason !== 'cancelled') {
              reject(new Error(failureReason || 'Print failed'));
            } else {
              resolve();
            }
          }
        );
      });
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy();
      fs.rmSync(htmlPath, { force: true });
    }

    logPrint(`Printed: ${fileName}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Export a copy of a document to a user-chosen location. Admin-only; the
// archive original is never modified.
ipcMain.handle('file:exportCopy', async (event, { filePath, userId }) => {
  let chosenPath = null;

  try {
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    // Stored paths may be legacy absolute or archive-relative; resolution
    // enforces containment within the current archive root
    const resolvedPath = resolveArchivePath(filePath);
    if (!resolvedPath) {
      return { success: false, error: 'File path is outside archive directory' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found' };
    }

    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      title: 'Export Copy',
      defaultPath: path.basename(resolvedPath)
    });

    if (canceled || !savePath) {
      return { success: true, canceled: true };
    }
    chosenPath = savePath;

    fs.copyFileSync(resolvedPath, chosenPath);

    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'document_shared', 'document', `Exported copy: ${path.basename(resolvedPath)} -> ${chosenPath}`);

    return { success: true, filePath: chosenPath };
  } catch (error) {
    // Remove a partial copy so a failed export never leaves a truncated file
    if (chosenPath && fs.existsSync(chosenPath)) {
      try { fs.rmSync(chosenPath, { force: true }); } catch {}
    }
    return { success: false, error: error.message };
  }
});

// Users management
ipcMain.handle('users:getAll', async (event, userId, opts = {}) => {
  try {
    // Check if user is admin
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    const total = getDb().prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const USER_SORT_COLUMNS = {
      username: 'username',
      role: 'role',
      status: 'status',
      created_at: 'created_at'
    };
    const orderCol = USER_SORT_COLUMNS[opts.sortBy] || 'username';
    const orderDir = String(opts.sortDir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const params = [];
    let query = `SELECT id, username, role, status, created_at, updated_at FROM users ORDER BY ${orderCol} ${orderDir}`;
    if (Number.isFinite(opts.limit) && opts.limit > 0) {
      query += ' LIMIT ? OFFSET ?';
      params.push(Math.max(1, Math.floor(opts.limit)), Math.max(0, Math.floor(opts.offset || 0)));
    }
    const users = getDb().prepare(query).all(...params);
    return { success: true, users, total };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('users:create', async (event, { username, password, role, createdBy }) => {
  try {
    // Check if user is admin
    if (!await isAdmin(createdBy)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = getDb().prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username, hashedPassword, role);

    // Log activity
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(createdBy, 'user_created', 'user', result.lastInsertRowid, `Created user: ${username}`);

    return { success: true, id: result.lastInsertRowid };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('users:updateStatus', async (event, { userId, status, updatedBy }) => {
  try {
    // Check if user is admin
    if (!await isAdmin(updatedBy)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    const target = getDb().prepare('SELECT role, status FROM users WHERE id = ?').get(userId);
    if (!target) {
      return { success: false, error: 'User not found.' };
    }

    // Never leave the system without an active administrator
    if (status === 'inactive' && target.status === 'active' && target.role === 'admin') {
      const activeAdmins = getDb().prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'"
      ).get();
      if (activeAdmins.count <= 1) {
        return { success: false, error: 'Cannot deactivate the last active administrator.' };
      }
    }

    getDb().prepare("UPDATE users SET status = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?")
      .run(status, userId);

    // Log activity
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(updatedBy, 'user_status_changed', 'user', userId, `Status changed to: ${status}`);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('users:delete', async (event, { userId, deletedBy }) => {
  try {
    // Check if user is admin
    if (!await isAdmin(deletedBy)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    if (userId === deletedBy) {
      return { success: false, error: 'You cannot delete your own account.' };
    }

    const target = getDb().prepare('SELECT username, role, status FROM users WHERE id = ?').get(userId);
    if (!target) {
      return { success: false, error: 'User not found.' };
    }

    // Deleting an account must never leave the system without an active
    // administrator. Only removing an active admin lowers that count, so an
    // inactive admin can always go as long as one active admin remains.
    if (target.role === 'admin') {
      const activeAdmins = getDb().prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'"
      ).get().count;
      const remaining = target.status === 'active' ? activeAdmins - 1 : activeAdmins;
      if (remaining < 1) {
        return { success: false, error: 'Cannot delete the last active administrator. Create another active admin first.' };
      }
    }

    // **PERMANENTLY DELETE** the user account — the row is removed entirely.
    // Activity logs keep their user_id and fall back to 'Deleted User'.
    getDb().prepare("DELETE FROM users WHERE id = ?").run(userId);

    // Log activity
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(deletedBy, 'user_deleted', 'user', userId, `Permanently deleted user: ${target.username}`);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('settings:get', async (event, key) => {
  try {
    const setting = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return { success: true, value: setting ? setting.value : null };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:set', async (event, { key, value, userId }) => {
  try {
    // Check if user is admin
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    getDb().prepare(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES (?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ','now')))
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    `).run(key, value, value);

    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'setting_updated', 'setting', `Updated setting: ${key}`);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// File dialogs
ipcMain.handle('dialog:openFile', async (event, options) => {
  const result = await dialog.showOpenDialog(getMainWindow(), options);
  if (!result.canceled && Array.isArray(result.filePaths)) {
    for (const picked of result.filePaths) {
      sessionPickedFiles.add(path.resolve(picked));
    }
  }
  return result;
});

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    properties: ['openDirectory', 'createDirectory']
  });
  return result;
});

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

// Activity logs
ipcMain.handle('logs:add', async (event, { userId, action, targetType, targetId, details }) => {
  try {
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Only administrators can add activity logs.' };
    }

    getDb().prepare(`
      INSERT INTO activity_logs (user_id, action, target_type, target_id, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, action, targetType || null, targetId || null, details || null);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('logs:getRecent', async (event, limit = 100, userId, offset = 0, sortBy = 'created_at', sortDir = 'desc') => {
  try {
    // Check if user is admin
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    const total = getDb().prepare('SELECT COUNT(*) AS count FROM activity_logs').get().count;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    const LOG_SORT_COLUMNS = {
      created_at: 'al.created_at',
      username: 'u.username',
      action: 'al.action',
      target_type: 'al.target_type'
    };
    const orderCol = LOG_SORT_COLUMNS[sortBy] || 'al.created_at';
    const orderDir = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const logs = getDb().prepare(`
      SELECT al.*, 
        COALESCE(u.username, 'Deleted User') as username
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ORDER BY ${orderCol} ${orderDir}
      LIMIT ? OFFSET ?
    `).all(safeLimit, safeOffset);
    
    return { success: true, logs, total };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Dashboard stats
ipcMain.handle('dashboard:getStats', async () => {
  try {
    const studentsCount = getDb().prepare('SELECT COUNT(*) as count FROM students WHERE deleted_at IS NULL').get();
    const documentsCount = getDb().prepare('SELECT COUNT(*) as count FROM documents WHERE deleted_at IS NULL').get();
    // Same column set as documents:search so the dashboard rows can be handed
    // straight to DocumentViewerModal. Students and users are LEFT joined:
    // accounts are hard-deleted, and a document must still open after its
    // creator or student link is gone.
    const recentDocs = getDb().prepare(`
      SELECT
        d.*,
        s.student_id AS student_number, s.first_name, s.last_name, s.middle_name,
        s.school_year, s.program_level,
        dt.name as document_type,
        COALESCE(d.created_by_name, u.username, 'Deleted User') as created_by_name
      FROM documents d
      LEFT JOIN students s ON d.student_id = s.id
      JOIN document_types dt ON d.document_type_id = dt.id
      LEFT JOIN users u ON d.created_by = u.id
      WHERE d.deleted_at IS NULL
      ORDER BY d.created_at DESC
      LIMIT 10
    `).all();
    
    return {
      success: true,
      stats: {
        totalStudents: studentsCount.count,
        totalDocuments: documentsCount.count,
        recentDocuments: recentDocs
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== IMAGE OPERATIONS ====================

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

ipcMain.handle('image:saveBase64', async (event, { base64Data, fileName, destPath }) => {
  try {
    // Get archive root from settings
    const archiveSetting = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('archive_directory');
    const archiveRoot = archiveSetting?.value || path.join(app.getPath('documents'), 'ADZU_Archive');
    
    // Validate path to prevent traversal attacks
    const validation = validateAndResolvePath(destPath, archiveRoot);
    if (!validation.valid) {
      return { success: false, error: `Security: ${validation.error}` };
    }

    // Ensure destination directory exists
    const destDir = path.dirname(validation.resolvedPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Remove data URL prefix if present
    const base64String = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64String, 'base64');

    // Write file
    fs.writeFileSync(validation.resolvedPath, buffer);

    return { success: true, filePath: validation.resolvedPath };
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

// ==================== FOLDER PATH GENERATION ====================

// Fixed archive layout (matches the office's physical structure):
//   <ArchiveRoot>/<ProgramFolder>/<Letter>/<LASTNAME, Firstname M. (SY)>/
// See item 2 of the spec. Program folder names are provisional pending
// client confirmation; the PDF only documents "College Student Records".
const PROGRAM_FOLDERS = {
  College: 'College Student Records',
  'Graduate School': 'Graduate Student Records',
  Medicine: 'Medical Student Records',
  Law: 'Law Student Records'
};

function sanitizeFolderName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '-').trim();
}

function buildStudentFolderName(student) {
  const lastName = student.last_name.trim();
  const firstName = student.first_name.trim();
  const middleInitial = student.middle_name && student.middle_name.trim()
    ? ` ${student.middle_name.trim()[0].toUpperCase()}.`
    : '';
  return sanitizeFolderName(`${lastName.toUpperCase()}, ${firstName}${middleInitial} (${student.school_year})`);
}

// Shared by folders:generatePath (renderer-supplied root) and
// documents:update (configured root). Resolves the destination
// document-type folder for a document, creating it, and returns
// { ok: true, folderPath, studentDir? } or { ok: false, error }.
function computeDocumentTypeFolder({ studentId, documentTypeName, archiveRoot }) {
  const root = archiveRoot || getArchiveRoot();
  const sanitizedType = sanitizeFolderName(documentTypeName || 'Uncategorized') || 'Uncategorized';

  // General document (no student): <Root>/General Documents/<DocumentTypeName>/
  if (!studentId) {
    const folderPath = path.join(root, 'General Documents', sanitizedType);
    fs.mkdirSync(folderPath, { recursive: true });
    return { ok: true, folderPath };
  }

  const student = getDb().prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) {
    return { ok: false, error: 'Student not found.' };
  }
  if (!student.program_level) {
    return { ok: false, error: `${student.first_name} ${student.last_name} has no Program Level set. Edit the student record first.` };
  }
  if (!student.school_year) {
    return { ok: false, error: `${student.first_name} ${student.last_name} has no School Year set. Edit the student record first.` };
  }

  const programFolder = PROGRAM_FOLDERS[student.program_level];
  if (!programFolder) {
    return { ok: false, error: `Unknown program level: ${student.program_level}` };
  }

  const letter = (student.last_name.trim()[0] || '#').toUpperCase();
  const studentDir = path.join(root, programFolder, letter, buildStudentFolderName(student));

  // Every document type gets its own folder inside the student directory:
  //   <StudentDir>/<DocumentTypeName>/<file>
  const folderPath = path.join(studentDir, sanitizedType);
  fs.mkdirSync(folderPath, { recursive: true });
  return { ok: true, folderPath, studentDir };
}

// Generate a Windows-safe filename following the pattern:
// LASTNAME, FIRSTNAME_DOCUMENT_TYPE_(COUNTER)
// For student documents only. General documents use plain document type name.
function buildStudentDocumentFileName(student, documentTypeName, ext, counter) {
  // Normalize names and document type to uppercase
  const lastName = student.last_name.trim().toUpperCase();
  const firstName = student.first_name.trim().toUpperCase();
  // Replace spaces in document type with underscores
  const docType = documentTypeName.trim().toUpperCase().replace(/\s+/g, '_');
  
  // Clean extension
  const cleanExt = String(ext || 'jpg').replace(/[^a-zA-Z0-9]/g, '');
  
  // Build base name
  const baseName = `${lastName}, ${firstName}_${docType}`;
  
  // Add counter
  const finalName = `${baseName}_(${counter}).${cleanExt}`;
  
  // Sanitize for Windows (remove invalid chars, trim trailing spaces/periods)
  return sanitizeWindowsFileName(finalName);
}

// Sanitize filename for Windows filesystem restrictions
function sanitizeWindowsFileName(name) {
  // Replace invalid Windows filename characters with dash
  let cleaned = name.replace(/[\\/:*?"<>|]/g, '-');
  // Remove control characters
  cleaned = cleaned.replace(/[\x00-\x1f\x80-\x9f]/g, '');
  // Remove trailing spaces and periods (Windows doesn't allow these)
  cleaned = cleaned.replace(/[\s.]+$/, '');
  // Ensure filename is not empty
  if (!cleaned || cleaned.trim().length === 0) {
    cleaned = 'document';
  }
  // Check for reserved Windows names
  const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  const nameWithoutExt = cleaned.split('.')[0].toUpperCase();
  if (reservedNames.includes(nameWithoutExt)) {
    cleaned = `_${cleaned}`;
  }
  // Limit total path length (Windows MAX_PATH is 260, leave room for directory path)
  if (cleaned.length > 200) {
    const parts = cleaned.split('.');
    const ext = parts.pop();
    const base = parts.join('.').substring(0, 195);
    cleaned = `${base}.${ext}`;
  }
  return cleaned;
}

// First candidate is the plain base name, then "(n)" suffixes. Scanning the
// filesystem (not the database) skips files left by older versions whose
// numbering started at "(2)", so names can never collide. startAt preserves
// generatePath's numbering after a legacy-file promotion (plain name taken,
// so the next candidate is "(2)").
function pickCollisionFreeFileName(folderPath, baseName, ext, startAt = 0) {
  const cleanExt = String(ext || 'dat').replace(/[^a-zA-Z0-9]/g, '');
  let n = startAt;
  for (;;) {
    const candidate = n === 0
      ? `${baseName}.${cleanExt}`
      : `${baseName} (${n}).${cleanExt}`;
    if (!fs.existsSync(path.join(folderPath, candidate))) {
      return candidate;
    }
    n++;
  }
}

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

ipcMain.handle('folders:generatePath', async (event, { studentId, documentTypeId, documentTypeName, archiveRoot, ext }) => {
  try {
    const folderResult = computeDocumentTypeFolder({ studentId, documentTypeName, archiveRoot });
    if (!folderResult.ok) {
      return { success: false, error: folderResult.error };
    }
    const typeFolder = folderResult.folderPath;

    // General document (no student): the type folder is the destination.
    if (!studentId) {
      const fileName = pickCollisionFreeFileName(typeFolder, documentTypeName, ext);
      return { success: true, folderPath: typeFolder, fileName, destPath: path.join(typeFolder, fileName) };
    }

    // Get student info for filename generation
    const student = getDb().prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!student) {
      return { success: false, error: 'Student not found.' };
    }

    // Find next counter for this student and document type
    // Check existing files in the folder to determine next counter
    const existingFiles = fs.readdirSync(typeFolder);
    const lastName = student.last_name.trim().toUpperCase();
    const firstName = student.first_name.trim().toUpperCase();
    const docType = documentTypeName.trim().toUpperCase().replace(/\s+/g, '_');
    const basePattern = `${lastName}, ${firstName}_${docType}_`;
    
    let maxCounter = 0;
    for (const fileName of existingFiles) {
      if (fileName.startsWith(basePattern)) {
        // Extract counter from filename like "NAME_TYPE_(1).ext" or "NAME_TYPE_(2).ext"
        const match = fileName.match(/_\((\d+)\)\.[^.]+$/);
        if (match) {
          const counter = parseInt(match[1], 10);
          if (counter > maxCounter) {
            maxCounter = counter;
          }
        }
      }
    }

    const nextCounter = maxCounter + 1;
    const fileName = buildStudentDocumentFileName(student, documentTypeName, ext, nextCounter);

    return { success: true, folderPath: folderResult.studentDir, fileName, destPath: path.join(typeFolder, fileName) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

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

// ==================== BACKUP & RESTORE ====================

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

function resolveArchiveDir(handle) {
  const row = handle.prepare('SELECT value FROM settings WHERE key = ?').get('archive_directory');
  return row?.value || path.join(userDataPath, 'Archive');
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

ipcMain.handle('backup:create', async (event, userId) => {
  if (!await isAdmin(userId)) {
    return { success: false, error: 'Permission denied. Admin access required.' };
  }

  let backupPath = null;
  let tempDbPath = null;

  try {
    // Open save dialog
    const result = await dialog.showSaveDialog({
      title: 'Save Backup',
      defaultPath: `registrar-backup-${Date.now()}.zip`,
      filters: [{ name: 'Backup Files', extensions: ['zip'] }]
    });

    if (result.canceled) {
      return { success: false, canceled: true };
    }

    backupPath = result.filePath;
    tempDbPath = path.join(app.getPath('temp'), `backup-${Date.now()}.db`);

    // SQLite's own backup API gives a consistent snapshot of the live database
    await getDb().backup(tempDbPath);

    const archiveDir = resolveArchiveDir(getDb());
    const hasArchive = fs.existsSync(archiveDir);

    // Create ZIP archive using archiver
    const archiver = require('archiver');
    const output = fs.createWriteStream(backupPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    let streamWarning = null;

    // archiver reports problems through events, so every listener has to be
    // attached before finalize(): an unhandled stream error would take down the
    // main process, and waiting for 'close' only after finalize() resolves can
    // miss it and hang this handler forever. finalize() must come AFTER the
    // pipe() and entry appends — it closes archiver's queue, and anything
    // appended later is rejected with "queue closed". Everything lives inside
    // the executor so a synchronous throw from an append also rejects `written`.
    const written = new Promise((resolve, reject) => {
      archive.on('warning', (err) => { streamWarning = streamWarning || err.message; });
      archive.on('error', reject);
      output.on('error', reject);
      output.on('close', resolve);

      archive.pipe(output);

      // Add database to ZIP
      archive.file(tempDbPath, { name: 'database.db' });

      // Add Archive folder to ZIP if it exists
      if (hasArchive) {
        archive.directory(archiveDir, 'Archive');
      }

      archive.finalize().catch(reject);
    });

    await written;

    const stats = fs.statSync(backupPath);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(2);

    // Log activity
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'backup_created', 'system',
           `Backup created: ${backupPath} (${sizeMb} MB)`);

    console.log(`Backup created successfully: ${backupPath} (${sizeMb} MB)`);

    return {
      success: true,
      filePath: backupPath,
      fileSize: stats.size,
      warning: hasArchive
        ? streamWarning
        : `Archive folder not found at ${archiveDir}; this backup contains the database only.`
    };

  } catch (error) {
    console.error('Backup creation error:', error);
    // A half-written ZIP would still look like a usable backup to the user
    if (backupPath) {
      fs.rmSync(backupPath, { force: true });
    }
    return { success: false, error: error.message };
  } finally {
    if (tempDbPath) {
      fs.rmSync(tempDbPath, { force: true });
    }
  }
});

ipcMain.handle('backup:restore', async (event, userId) => {
  if (!await isAdmin(userId)) {
    return { success: false, error: 'Permission denied. Admin access required.' };
  }

  // Open file dialog
  const result = await dialog.showOpenDialog({
    title: 'Select Backup File',
    filters: [{ name: 'Backup Files', extensions: ['zip'] }],
    properties: ['openFile']
  });

  if (result.canceled) {
    return { success: false, canceled: true };
  }

  const backupFilePath = result.filePaths[0];
  const AdmZip = require('adm-zip');
  const stamp = Date.now();
  const tempExtractPath = path.join(app.getPath('temp'), `restore-${stamp}`);
  const safetyDbPath = path.join(app.getPath('temp'), `registrar-pre-restore-${stamp}.db`);
  let dbClosed = false;
  let dbReplaced = false;

  try {
    let zip;
    try {
      zip = new AdmZip(backupFilePath);
    } catch (zipError) {
      throw new Error(`That file is not a readable ZIP archive (${zipError.message}).`);
    }

    // Extract to temp location
    console.log(`Extracting backup to: ${tempExtractPath}`);
    zip.extractAllTo(tempExtractPath, true);

    const extractedDbPath = path.join(tempExtractPath, 'database.db');
    const extractedArchivePath = path.join(tempExtractPath, 'Archive');

    if (!fs.existsSync(extractedDbPath)) {
      throw new Error('Invalid backup — database.db not found in the backup file.');
    }

    // Validate the backup database before anything live is overwritten
    const archiveDir = inspectBackupDatabase(extractedDbPath);
    const hasArchiveInBackup = fs.existsSync(extractedArchivePath);

    if (hasArchiveInBackup && !isSafeArchiveTarget(archiveDir)) {
      throw new Error(`Refusing to replace the archive folder at "${archiveDir}" — that is not a valid archive location.`);
    }

    // Log BEFORE the destructive part so the attempt survives a failed restore
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'backup_restore_started', 'system',
           `Restoring from: ${backupFilePath}`);

    // Snapshot the live database so a failure halfway through can be undone
    await getDb().backup(safetyDbPath);

    // Close database connection
    console.log('Closing database connection...');
    getDb().close();
    dbClosed = true;

    // Replace live database
    console.log('Replacing database file...');
    removeDatabaseSidecars(dbPath);
    fs.copyFileSync(extractedDbPath, dbPath);
    dbReplaced = true;

    // Reopen database
    console.log('Reopening database connection...');
    setDb(new Database(dbPath));
    registerDbFunctions(getDb());
    dbClosed = false;

    // A backup can predate the current schema; migrate it now instead of
    // leaving the rest of this session running against unmigrated tables.
    runMigrations();

    // Replace Archive folder
    if (hasArchiveInBackup) {
      console.log('Replacing archive folder...');
      const displacedArchive = fs.existsSync(archiveDir) ? `${archiveDir}.pre-restore-${stamp}` : null;
      try {
        if (displacedArchive) {
          fs.renameSync(archiveDir, displacedArchive);
        }
        fs.cpSync(extractedArchivePath, archiveDir, { recursive: true });
      } catch (archiveError) {
        // Put the previous folder back so documents don't point at deleted files
        if (displacedArchive) {
          fs.rmSync(archiveDir, { recursive: true, force: true });
          fs.renameSync(displacedArchive, archiveDir);
        }
        throw new Error(`the archive folder could not be replaced (${archiveError.message})`);
      }
      if (displacedArchive) {
        fs.rmSync(displacedArchive, { recursive: true, force: true });
      }
    }

    // Log success
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'backup_restore_completed', 'system',
           `Restored from: ${backupFilePath}`);

    fs.rmSync(safetyDbPath, { force: true });

    console.log('Backup restored successfully');

    return {
      success: true,
      message: hasArchiveInBackup
        ? 'Backup restored successfully. Close the application and open it again so every screen reloads the restored data.'
        : 'Backup restored successfully, but it contained no Archive folder — the database was replaced and the existing document files were left untouched. Close the application and open it again so every screen reloads the restored data.'
    };

  } catch (error) {
    console.error('Backup restore error:', error);

    // Put the live database back the way it was if it had already been replaced
    try {
      if (dbReplaced && fs.existsSync(safetyDbPath)) {
        if (!dbClosed) {
          getDb().close();
          dbClosed = true;
        }
        removeDatabaseSidecars(dbPath);
        fs.copyFileSync(safetyDbPath, dbPath);
      }
      if (dbClosed) {
        setDb(new Database(dbPath));
        registerDbFunctions(getDb());
        dbClosed = false;
        runMigrations();
      }
      fs.rmSync(safetyDbPath, { force: true });
    } catch (recoverError) {
      console.error('Recovery after failed restore:', recoverError);
      return {
        success: false,
        error: `Restore failed (${error.message}) and the database could not be reopened automatically. A safety copy of your data is at ${safetyDbPath}.`
      };
    }

    return {
      success: false,
      error: dbReplaced
        ? `${error.message} The restore was rolled back and your previous data is intact.`
        : error.message
    };
  } finally {
    // Clean up temp files
    fs.rmSync(tempExtractPath, { recursive: true, force: true });
  }
});
