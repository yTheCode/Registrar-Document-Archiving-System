// settings:* handlers (moved verbatim from main.cjs in phase 1b).
const { ipcMain } = require('electron');
const { getDb } = require('../db/connection.cjs');
const { isAdmin } = require('../services/authz.cjs');


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
