// users:* handlers (moved verbatim from main.cjs in phase 1b).
const { ipcMain } = require('electron');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection.cjs');
const { isAdmin } = require('../services/authz.cjs');


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
