// Authorization helper shared by every admin-guarded IPC handler. The db
// handle is read at call time because backup/restore replaces it mid-session.
// Q5: a caller id is only trusted when it is the account that logged in and
// that account's row is still an active administrator.
const { getDb } = require('../db/connection.cjs');
const { session } = require('../security/session.cjs');
const { decideAdmin } = require('../security/adminDecision.cjs');

// Helper function to check if user is admin
async function isAdmin(userId) {
  if (!session.isCurrentUser(userId)) return false;
  const row = getDb().prepare('SELECT role, status FROM users WHERE id = ?').get(userId);
  return decideAdmin({ session: session.get(), userId, row });
}

module.exports = { isAdmin };
