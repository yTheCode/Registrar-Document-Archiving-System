// Path anchors for the Electron main process. This file must stay directly in
// electron/ so its __dirname-derived constants resolve to the same locations
// the original module-level code in main.cjs did, no matter which module
// requires it. Requiring it performs the import-time side effects (create the
// database folder, copy a legacy database) exactly once, before any module
// touches those paths — require it first in main.cjs.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// Database lives in the OS app-data folder so it survives reinstalls.
const userDataPath = app.getPath('userData');
const dbDir = path.join(userDataPath, 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'registrar_archive.db');
const legacyDbPath = path.join(__dirname, '..', 'database', 'registrar_archive.db');
if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
  fs.copyFileSync(legacyDbPath, dbPath);
  console.log('Migrated database from the legacy project folder to userData');
}

const ELECTRON_DIR = __dirname;
const PROJECT_ROOT = path.join(__dirname, '..');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

module.exports = {
  userDataPath,
  dbDir,
  dbPath,
  legacyDbPath,
  ELECTRON_DIR,
  PROJECT_ROOT,
  PRELOAD_PATH
};
