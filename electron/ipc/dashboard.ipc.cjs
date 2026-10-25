// dashboard:getStats (moved verbatim from main.cjs in phase 1b).
const { ipcMain } = require('electron');
const { getDb } = require('../db/connection.cjs');


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
