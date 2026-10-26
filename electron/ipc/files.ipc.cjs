// file:* handlers (copy, open, read, print, export) (moved verbatim from main.cjs in phase 1b).
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { dbDir, dbPath, ELECTRON_DIR, PRELOAD_PATH } = require('../paths.cjs');
const { getDb } = require('../db/connection.cjs');
const { isAdmin } = require('../services/authz.cjs');
const { validateAndResolvePath, resolveArchivePath } = require('../services/archivePaths.cjs');
const { sessionPickedFiles } = require('../services/pickedFiles.cjs');
const { resolveRuntimeMode } = require('../security/runtimeMode.cjs');

// Q2: DevTools exist only in a dev build, on every window this process creates.
const { devTools } = resolveRuntimeMode({ isPackaged: app.isPackaged });


// File operations
ipcMain.handle('file:copy', async (event, { sourcePath, destPath }) => {
  try {
    // Get archive root from settings
    const archiveSetting = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('archive_directory');
    const archiveRoot = archiveSetting?.value || path.join(app.getPath('documents'), 'ADZU_Archive');
    
    // Validate destination path to prevent traversal attacks
    const validation = validateAndResolvePath(destPath, archiveRoot);
    if (!validation.valid) {
      return { success: false, error: `Security: ${validation.error}` };
    }

    // Ensure destination directory exists
    const destDir = path.dirname(validation.resolvedPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Copy file
    fs.copyFileSync(sourcePath, validation.resolvedPath);
    return { success: true, filePath: validation.resolvedPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:openExternal', async (event, filePath) => {
  try {
    // Stored paths may be legacy absolute or archive-relative; resolution
    // enforces containment within the current archive root
    const resolvedPath = resolveArchivePath(filePath);
    if (!resolvedPath) {
      return { success: false, error: 'File path is outside archive directory' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found' };
    }

    const { shell } = require('electron');
    await shell.openPath(resolvedPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:showInFolder', async (event, filePath) => {
  try {
    // Stored paths may be legacy absolute or archive-relative; resolution
    // enforces containment within the current archive root
    const resolvedPath = resolveArchivePath(filePath);
    if (!resolvedPath) {
      return { success: false, error: 'File path is outside archive directory' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found' };
    }

    const { shell } = require('electron');
    shell.showItemInFolder(resolvedPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:readAsBase64', async (event, filePath) => {
  try {
    // Stored paths may be legacy absolute or archive-relative; resolution
    // enforces containment within the current archive root
    const resolvedPath = resolveArchivePath(filePath);
    if (!resolvedPath) {
      return { success: false, error: 'File path is outside archive directory' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found' };
    }

    const data = fs.readFileSync(resolvedPath);
    const base64 = data.toString('base64');
    const ext = path.extname(resolvedPath).toLowerCase();
    let mimeType = 'application/octet-stream';
    
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    
    mimeType = mimeTypes[ext] || mimeType;

    return { success: true, base64, mimeType };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Read a file the user explicitly picked THIS session (via the open-file dialog)
// as base64. Unlike file:readAsBase64 this does NOT enforce archive containment:
// pre-import uploads still live outside the archive and must be previewable and
// editable before they are copied in. Only image mime types are returned.


function isForbiddenPickedPath(resolved) {
  const forbidden = [dbDir, dbPath, ELECTRON_DIR];
  if (process.platform === 'win32') {
    forbidden.push(path.resolve(process.env.SystemRoot || 'C:\\Windows'));
  } else {
    forbidden.push('/etc', '/usr', '/bin', '/sbin', '/System');
  }
  return forbidden.some((fp) => {
    const abs = path.resolve(fp);
    return resolved === abs || resolved.startsWith(abs + path.sep);
  });
}

ipcMain.handle('file:readPickedAsBase64', async (event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' };
    }
    const resolved = path.resolve(filePath);

    if (isForbiddenPickedPath(resolved) || !sessionPickedFiles.has(resolved)) {
      return { success: false, error: 'Access to this location is not permitted' };
    }

    if (!fs.existsSync(resolved)) {
      return { success: false, error: 'File not found' };
    }
    const ext = path.extname(resolved).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif'
    };
    const mimeType = mimeTypes[ext];
    if (!mimeType) {
      return { success: false, error: 'Only image files can be edited' };
    }
    const base64 = fs.readFileSync(resolved).toString('base64');
    return { success: true, base64, mimeType };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Print a document. Images go through a hidden fit-to-page window with the
// system print dialog; PDFs and office formats open in the default app —
// Chromium's print pipeline can't rasterize the PDF plugin or office viewers.
ipcMain.handle('file:print', async (event, { filePath, userId }) => {
  const logPrint = (details) => {
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'document_printed', 'document', details);
  };

  try {
    // Stored paths may be legacy absolute or archive-relative; resolution
    // enforces containment within the current archive root
    const resolvedPath = resolveArchivePath(filePath);
    if (!resolvedPath) {
      return { success: false, error: 'File path is outside archive directory' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found' };
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const fileName = path.basename(resolvedPath);

    if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png' && ext !== '.gif') {
      const { shell } = require('electron');
      await shell.openPath(resolvedPath);
      logPrint(`Opened for print (external app): ${fileName}`);
      return { success: true, external: true };
    }

    // Image: hidden window with the image fit to one page
    const { pathToFileURL } = require('url');
    const htmlPath = path.join(app.getPath('temp'), `adzu-print-${Date.now()}.html`);
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: auto; margin: 12mm; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body { display: flex; align-items: center; justify-content: center; }
  img { max-width: 100%; max-height: 100vh; object-fit: contain; }
</style>
</head>
<body>
  <img src="${pathToFileURL(resolvedPath).href}" alt="">
</body>
</html>`;
    fs.writeFileSync(htmlPath, html);

    const printWindow = new BrowserWindow({
      show: false,
      width: 850,
      height: 1100,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        devTools,
        preload: PRELOAD_PATH
      }
    });

    try {
      await printWindow.loadFile(htmlPath);
      await new Promise((resolve, reject) => {
        printWindow.webContents.print(
          { silent: false, printBackground: true },
          (success, failureReason) => {
            if (!success && failureReason !== 'cancelled') {
              reject(new Error(failureReason || 'Print failed'));
            } else {
              resolve();
            }
          }
        );
      });
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy();
      fs.rmSync(htmlPath, { force: true });
    }

    logPrint(`Printed: ${fileName}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Export a copy of a document to a user-chosen location. Admin-only; the
// archive original is never modified.
ipcMain.handle('file:exportCopy', async (event, { filePath, userId }) => {
  let chosenPath = null;

  try {
    if (!await isAdmin(userId)) {
      return { success: false, error: 'Permission denied. Admin access required.' };
    }

    // Stored paths may be legacy absolute or archive-relative; resolution
    // enforces containment within the current archive root
    const resolvedPath = resolveArchivePath(filePath);
    if (!resolvedPath) {
      return { success: false, error: 'File path is outside archive directory' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found' };
    }

    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      title: 'Export Copy',
      defaultPath: path.basename(resolvedPath)
    });

    if (canceled || !savePath) {
      return { success: true, canceled: true };
    }
    chosenPath = savePath;

    fs.copyFileSync(resolvedPath, chosenPath);

    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'document_shared', 'document', `Exported copy: ${path.basename(resolvedPath)} -> ${chosenPath}`);

    return { success: true, filePath: chosenPath };
  } catch (error) {
    // Remove a partial copy so a failed export never leaves a truncated file
    if (chosenPath && fs.existsSync(chosenPath)) {
      try { fs.rmSync(chosenPath, { force: true }); } catch {}
    }
    return { success: false, error: error.message };
  }
});
