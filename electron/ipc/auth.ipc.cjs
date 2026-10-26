// auth:login (moved verbatim from main.cjs in phase 1b).
const { ipcMain } = require('electron');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection.cjs');
const { session } = require('../security/session.cjs');


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

    // The main process now remembers who logged in. A successful login replaces
    // any previous session; a failed one leaves it untouched.
    session.set(user);

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

// The renderer drops its sessionStorage copy; the main process must forget the
// account too, or a stale renderer id would keep passing the admin checks.
ipcMain.handle('auth:logout', async () => {
  session.clear();
  return { success: true };
});
