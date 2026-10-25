// documentTypes:* handlers (moved verbatim from main.cjs in phase 1b).
const { ipcMain } = require('electron');
const { getDb } = require('../db/connection.cjs');
const { isAdmin } = require('../services/authz.cjs');


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
