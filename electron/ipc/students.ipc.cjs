// students:* handlers (moved verbatim from main.cjs in phase 1b).
const { ipcMain } = require('electron');
const { getDb } = require('../db/connection.cjs');
const { isAdmin } = require('../services/authz.cjs');
const { buildStudentPage, buildStudentListWhere } = require('../services/studentQueries.cjs');


// Students
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
