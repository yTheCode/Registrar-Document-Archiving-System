// The one user the main process knows is logged in. The renderer's
// sessionStorage copy is a UI convenience only; authorization reads this.
// Single-window app: exactly one session exists, and a second login replaces
// it. No electron import and no db access, so tests can load it directly.

function createSession() {
  let current = null;

  function get() {
    return current ? { ...current } : null;
  }

  function set(user) {
    current = user
      ? {
          userId: user.id,
          username: user.username,
          role: user.role
        }
      : null;
  }

  function clear() {
    current = null;
  }

  function isCurrentUser(userId) {
    if (current === null) return false;
    if (userId === null || userId === undefined) return false;
    return String(current.userId) === String(userId);
  }

  return { get, set, clear, isCurrentUser };
}

const session = createSession();

module.exports = { createSession, session };
