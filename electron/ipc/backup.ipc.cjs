// backup:* handlers (create, restore) (moved verbatim from main.cjs in phase 1b).
const { app, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { dbPath } = require('../paths.cjs');
const { getDb, setDb, registerDbFunctions } = require('../db/connection.cjs');
const { runMigrations } = require('../db/migrations.cjs');
const { isAdmin } = require('../services/authz.cjs');
const { ensureArchiveSetting } = require('../services/archivePaths.cjs');
const { isSafeArchiveTarget, resolveArchiveDir, inspectBackupDatabase, removeDatabaseSidecars } = require('../services/backup.cjs');


// ==================== BACKUP & RESTORE ====================

ipcMain.handle('backup:create', async (event, userId) => {
  if (!await isAdmin(userId)) {
    return { success: false, error: 'Permission denied. Admin access required.' };
  }

  let backupPath = null;
  let tempDbPath = null;

  try {
    // Open save dialog
    const result = await dialog.showSaveDialog({
      title: 'Save Backup',
      defaultPath: `registrar-backup-${Date.now()}.zip`,
      filters: [{ name: 'Backup Files', extensions: ['zip'] }]
    });

    if (result.canceled) {
      return { success: false, canceled: true };
    }

    backupPath = result.filePath;
    tempDbPath = path.join(app.getPath('temp'), `backup-${Date.now()}.db`);

    // SQLite's own backup API gives a consistent snapshot of the live database
    await getDb().backup(tempDbPath);

    const archiveDir = resolveArchiveDir(getDb());
    const hasArchive = fs.existsSync(archiveDir);

    // Create ZIP archive using archiver
    const archiver = require('archiver');
    const output = fs.createWriteStream(backupPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    let streamWarning = null;

    // archiver reports problems through events, so every listener has to be
    // attached before finalize(): an unhandled stream error would take down the
    // main process, and waiting for 'close' only after finalize() resolves can
    // miss it and hang this handler forever. finalize() must come AFTER the
    // pipe() and entry appends — it closes archiver's queue, and anything
    // appended later is rejected with "queue closed". Everything lives inside
    // the executor so a synchronous throw from an append also rejects `written`.
    const written = new Promise((resolve, reject) => {
      archive.on('warning', (err) => { streamWarning = streamWarning || err.message; });
      archive.on('error', reject);
      output.on('error', reject);
      output.on('close', resolve);

      archive.pipe(output);

      // Add database to ZIP
      archive.file(tempDbPath, { name: 'database.db' });

      // Add Archive folder to ZIP if it exists
      if (hasArchive) {
        archive.directory(archiveDir, 'Archive');
      }

      archive.finalize().catch(reject);
    });

    await written;

    const stats = fs.statSync(backupPath);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(2);

    // Log activity
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'backup_created', 'system',
           `Backup created: ${backupPath} (${sizeMb} MB)`);

    console.log(`Backup created successfully: ${backupPath} (${sizeMb} MB)`);

    return {
      success: true,
      filePath: backupPath,
      fileSize: stats.size,
      warning: hasArchive
        ? streamWarning
        : `Archive folder not found at ${archiveDir}; this backup contains the database only.`
    };

  } catch (error) {
    console.error('Backup creation error:', error);
    // A half-written ZIP would still look like a usable backup to the user
    if (backupPath) {
      fs.rmSync(backupPath, { force: true });
    }
    return { success: false, error: error.message };
  } finally {
    if (tempDbPath) {
      fs.rmSync(tempDbPath, { force: true });
    }
  }
});

ipcMain.handle('backup:restore', async (event, userId) => {
  if (!await isAdmin(userId)) {
    return { success: false, error: 'Permission denied. Admin access required.' };
  }

  // Open file dialog
  const result = await dialog.showOpenDialog({
    title: 'Select Backup File',
    filters: [{ name: 'Backup Files', extensions: ['zip'] }],
    properties: ['openFile']
  });

  if (result.canceled) {
    return { success: false, canceled: true };
  }

  const backupFilePath = result.filePaths[0];
  const AdmZip = require('adm-zip');
  const stamp = Date.now();
  const tempExtractPath = path.join(app.getPath('temp'), `restore-${stamp}`);
  const safetyDbPath = path.join(app.getPath('temp'), `registrar-pre-restore-${stamp}.db`);
  let dbClosed = false;
  let dbReplaced = false;

  try {
    let zip;
    try {
      zip = new AdmZip(backupFilePath);
    } catch (zipError) {
      throw new Error(`That file is not a readable ZIP archive (${zipError.message}).`);
    }

    // Extract to temp location
    console.log(`Extracting backup to: ${tempExtractPath}`);
    zip.extractAllTo(tempExtractPath, true);

    const extractedDbPath = path.join(tempExtractPath, 'database.db');
    const extractedArchivePath = path.join(tempExtractPath, 'Archive');

    if (!fs.existsSync(extractedDbPath)) {
      throw new Error('Invalid backup — database.db not found in the backup file.');
    }

    // Validate the backup database before anything live is overwritten
    const archiveDir = inspectBackupDatabase(extractedDbPath);
    const hasArchiveInBackup = fs.existsSync(extractedArchivePath);

    if (hasArchiveInBackup && !isSafeArchiveTarget(archiveDir)) {
      throw new Error(`Refusing to replace the archive folder at "${archiveDir}" — that is not a valid archive location.`);
    }

    // Log BEFORE the destructive part so the attempt survives a failed restore
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'backup_restore_started', 'system',
           `Restoring from: ${backupFilePath}`);

    // Snapshot the live database so a failure halfway through can be undone
    await getDb().backup(safetyDbPath);

    // Close database connection
    console.log('Closing database connection...');
    getDb().close();
    dbClosed = true;

    // Replace live database
    console.log('Replacing database file...');
    removeDatabaseSidecars(dbPath);
    fs.copyFileSync(extractedDbPath, dbPath);
    dbReplaced = true;

    // Reopen database
    console.log('Reopening database connection...');
    setDb(new Database(dbPath));
    registerDbFunctions(getDb());
    dbClosed = false;

    // A backup can predate the current schema; migrate it now instead of
    // leaving the rest of this session running against unmigrated tables.
    runMigrations();

    // Q11: the restored database may have no archive setting at all. Write the
    // shared default now, so the folder this handler is about to replace is
    // the folder every later consumer reads from.
    ensureArchiveSetting();

    // Replace Archive folder
    if (hasArchiveInBackup) {
      console.log('Replacing archive folder...');
      const displacedArchive = fs.existsSync(archiveDir) ? `${archiveDir}.pre-restore-${stamp}` : null;
      try {
        if (displacedArchive) {
          fs.renameSync(archiveDir, displacedArchive);
        }
        fs.cpSync(extractedArchivePath, archiveDir, { recursive: true });
      } catch (archiveError) {
        // Put the previous folder back so documents don't point at deleted files
        if (displacedArchive) {
          fs.rmSync(archiveDir, { recursive: true, force: true });
          fs.renameSync(displacedArchive, archiveDir);
        }
        throw new Error(`the archive folder could not be replaced (${archiveError.message})`);
      }
      if (displacedArchive) {
        fs.rmSync(displacedArchive, { recursive: true, force: true });
      }
    }

    // Log success
    getDb().prepare('INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)')
      .run(userId, 'backup_restore_completed', 'system',
           `Restored from: ${backupFilePath}`);

    fs.rmSync(safetyDbPath, { force: true });

    console.log('Backup restored successfully');

    return {
      success: true,
      message: hasArchiveInBackup
        ? 'Backup restored successfully. Close the application and open it again so every screen reloads the restored data.'
        : 'Backup restored successfully, but it contained no Archive folder — the database was replaced and the existing document files were left untouched. Close the application and open it again so every screen reloads the restored data.'
    };

  } catch (error) {
    console.error('Backup restore error:', error);

    // Put the live database back the way it was if it had already been replaced
    try {
      if (dbReplaced && fs.existsSync(safetyDbPath)) {
        if (!dbClosed) {
          getDb().close();
          dbClosed = true;
        }
        removeDatabaseSidecars(dbPath);
        fs.copyFileSync(safetyDbPath, dbPath);
      }
      if (dbClosed) {
        setDb(new Database(dbPath));
        registerDbFunctions(getDb());
        dbClosed = false;
        runMigrations();
        ensureArchiveSetting();
      }
      fs.rmSync(safetyDbPath, { force: true });
    } catch (recoverError) {
      console.error('Recovery after failed restore:', recoverError);
      return {
        success: false,
        error: `Restore failed (${error.message}) and the database could not be reopened automatically. A safety copy of your data is at ${safetyDbPath}.`
      };
    }

    return {
      success: false,
      error: dbReplaced
        ? `${error.message} The restore was rolled back and your previous data is intact.`
        : error.message
    };
  } finally {
    // Clean up temp files
    fs.rmSync(tempExtractPath, { recursive: true, force: true });
  }
});
