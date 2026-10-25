// Requiring an *.ipc.cjs module registers its ipcMain handlers (top-level
// registration, exactly as in the original single-file main.cjs). Order is
// irrelevant: all 46 channel names are unique.
function registerAllIpc() {
  require('./auth.ipc.cjs');
  require('./students.ipc.cjs');
  require('./documents.ipc.cjs');
  require('./documentTypes.ipc.cjs');
  require('./files.ipc.cjs');
  require('./users.ipc.cjs');
  require('./settings.ipc.cjs');
  require('./dialogs.ipc.cjs');
  require('./archive.ipc.cjs');
  require('./logs.ipc.cjs');
  require('./dashboard.ipc.cjs');
  require('./images.ipc.cjs');
  require('./folders.ipc.cjs');
  require('./backup.ipc.cjs');
}

module.exports = { registerAllIpc };
