// dialog:* handlers (moved verbatim from main.cjs in phase 1b).
const { dialog, ipcMain } = require('electron');
const path = require('path');
const { getMainWindow } = require('../window.cjs');
const { sessionPickedFiles } = require('../services/pickedFiles.cjs');


// File dialogs
ipcMain.handle('dialog:openFile', async (event, options) => {
  const result = await dialog.showOpenDialog(getMainWindow(), options);
  if (!result.canceled && Array.isArray(result.filePaths)) {
    for (const picked of result.filePaths) {
      sessionPickedFiles.add(path.resolve(picked));
    }
  }
  return result;
});

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    properties: ['openDirectory', 'createDirectory']
  });
  return result;
});
