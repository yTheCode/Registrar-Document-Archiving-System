const { ipcMain } = require('electron');

// Requiring an *.ipc.cjs module registers its ipcMain handlers (top-level
// registration, exactly as in the original single-file main.cjs). Order is
// irrelevant: all 46 channel names are unique.
//
// Q6: ipcMain.handle is swapped for a guarded version once, around the
// requires below, so every channel runs the sender guard before its own body.
// The handler modules are untouched. The swap is restored afterwards so a
// module that somehow escaped it fails a test instead of silently bypassing it.
function registerAllIpc({ validateSender } = {}) {
  if (typeof validateSender !== 'function') {
    console.error('IPC sender guard is missing: every IPC call will be denied.');
  }

  const handle = ipcMain.handle;
  ipcMain.handle = function guardedHandle(channel, listener) {
    return handle.call(ipcMain, channel, (event, ...args) => {
      if (typeof validateSender !== 'function' || !validateSender(event)) {
        return { success: false, error: 'Permission denied' };
      }
      return listener(event, ...args);
    });
  };

  try {
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
  } finally {
    ipcMain.handle = handle;
  }
}

module.exports = { registerAllIpc };
