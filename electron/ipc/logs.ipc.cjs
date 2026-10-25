// logs:* handlers (moved verbatim from main.cjs in phase 1b).
const { ipcMain } = require('electron');
const { getDb } = require('../db/connection.cjs');
const { isAdmin } = require('../services/authz.cjs');


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
