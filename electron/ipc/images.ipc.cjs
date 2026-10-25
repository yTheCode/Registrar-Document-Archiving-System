// image:saveBase64 (moved verbatim from main.cjs in phase 1b).
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/connection.cjs');
const { validateAndResolvePath } = require('../services/archivePaths.cjs');


// ==================== IMAGE OPERATIONS ====================

ipcMain.handle('image:saveBase64', async (event, { base64Data, fileName, destPath }) => {
  try {
    // Get archive root from settings
    const archiveSetting = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('archive_directory');
    const archiveRoot = archiveSetting?.value || path.join(app.getPath('documents'), 'ADZU_Archive');
    
    // Validate path to prevent traversal attacks
    const validation = validateAndResolvePath(destPath, archiveRoot);
    if (!validation.valid) {
      return { success: false, error: `Security: ${validation.error}` };
    }

    // Ensure destination directory exists
    const destDir = path.dirname(validation.resolvedPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Remove data URL prefix if present
    const base64String = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64String, 'base64');

    // Write file
    fs.writeFileSync(validation.resolvedPath, buffer);

    return { success: true, filePath: validation.resolvedPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
