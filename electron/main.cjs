const { app, BrowserWindow, dialog, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// paths.cjs must be required first: its import-time side effects (database
// folder creation, legacy database copy) previously ran here at module load.
const { dbPath } = require('./paths.cjs');
const { setMainWindow, getMainWindow } = require('./window.cjs');
const { initializeDatabase, closeDatabase } = require('./db/connection.cjs');
const { migrateDocumentTypeFolders, migrateToRelativePaths } = require('./services/archiveMigrations.cjs');
const { registerAllIpc } = require('./ipc/index.cjs');
const { session } = require('./security/session.cjs');
const { createSenderGuard, createUrlPolicy } = require('./security/senderGuard.cjs');
const { resolveRuntimeMode } = require('./security/runtimeMode.cjs');
const { isBlockedShortcut } = require('./security/blockedKeys.cjs');

const INDEX_HTML_PATH = path.join(__dirname, '../dist/index.html');

// Q1: production means packaged. This is the only dev/production decision in the
// process, and it reads nothing from the environment.
const { isDev, devServerUrl, devTools } = resolveRuntimeMode({ isPackaged: app.isPackaged });

// Q6: the only pages allowed to call IPC are the ones this process loads into
// the main window.
const isAllowedUrl = createUrlPolicy({
  indexFileUrl: pathToFileURL(INDEX_HTML_PATH).href,
  devServerOrigin: devServerUrl
});

const validateSender = createSenderGuard({
  getMainWebContents: () => {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win.webContents : null;
  },
  isAllowedUrl
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools,
      preload: path.join(__dirname, 'preload.js')
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../src/assets/adzu-seal.png')
  });
  setMainWindow(mainWindow);

  // Q2: a packaged build has no DevTools and no menu, and the shortcuts that
  // would open or reload them are swallowed before the renderer sees them.
  if (!isDev) {
    Menu.setApplicationMenu(null);
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (isBlockedShortcut(input)) event.preventDefault();
    });
  }

  // The app is single-window: once this window goes away nobody is logged in.
  mainWindow.on('closed', () => {
    session.clear();
  });

  // Load app. Only an unpackaged build can reach the dev server; an installed
  // copy always loads the packaged dist/index.html.
  if (isDev) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(INDEX_HTML_PATH);
  }

  // DevTools follow the same decision.
  if (devTools) mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  try {
    initializeDatabase();

    // Move any legacy flat-stored student documents into document-type folders
    migrateDocumentTypeFolders();

    // Rewrite legacy absolute document paths archive-relative
    migrateToRelativePaths();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    dialog.showErrorBox(
      'Database initialization failed',
      `The application could not open its database.\n\n` +
      `Path: ${dbPath}\n\n` +
      `Error: ${error && error.message ? error.message : String(error)}\n\n` +
      `If this mentions NODE_MODULE_VERSION, run "npm run rebuild" to recompile ` +
      `better-sqlite3 against this Electron version.`
    );
    app.quit();
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  closeDatabase();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDatabase();
    app.quit();
  }
});

registerAllIpc({ validateSender });
