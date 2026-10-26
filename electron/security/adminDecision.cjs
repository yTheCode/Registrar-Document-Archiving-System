// Pure authorization decision: may this caller act as an administrator?
// session = the stored session (or null)
// userId  = the id the IPC handler received from the renderer
// row     = the users row read at decision time ({ role, status }), or undefined
// No db and no electron import: the caller reads the row and passes it in.
function decideAdmin({ session, userId, row } = {}) {
  if (!session) return false;
  if (userId === null || userId === undefined) return false;
  if (String(session.userId) !== String(userId)) return false;
  if (!row) return false;
  return row.role === 'admin' && row.status === 'active';
}

module.exports = { decideAdmin };
