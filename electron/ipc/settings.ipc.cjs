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

    // Q11: the archive root has one writer, archive:changeDirectory, which
    // validates the target and moves or re-points the files. A raw setting
    // write here would leave the files and the database disagreeing.
    if (key === 'archive_directory') {
      return {
        success: false,
        error: 'The archive folder cannot be changed here. Use Settings → Archive Location, which moves or re-points the archived files.'
      };
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
