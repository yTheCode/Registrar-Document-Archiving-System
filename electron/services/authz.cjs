// Authorization helper shared by every admin-guarded IPC handler. The db
// handle is read at call time because backup/restore replaces it mid-session.
const { getDb } = require('../db/connection.cjs');

// Helper function to check if user is admin
async function isAdmin(userId) {
  if (!userId) return false;
  const user = getDb().prepare('SELECT role FROM users WHERE id = ?').get(userId);
  return user && user.role === 'admin';
}

module.exports = { isAdmin };
