// The single better-sqlite3 handle for the main process. The handle is
// reassigned at runtime (backup/restore closes and reopens it), so consumers
// must call getDb() at use time — never capture the handle at require time.
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { dbPath } = require('../paths.cjs');
const { runMigrations } = require('./migrations.cjs');

let db;

function getDb() {
  return db;
}

function setDb(handle) {
  db = handle;
}

// SQL helpers that must exist on every live connection. doc_academic_year
// extracts the year tag from a document's metadata_json; parsing in JS means
// malformed or legacy JSON yields NULL instead of the "malformed JSON" error
// that json_extract would throw inside a query (which would fail every search,
// not just year-filtered ones). Must be re-registered after every reopen,
// including the backup/restore path.
function registerDbFunctions(handle) {
  handle.function('doc_academic_year', { deterministic: true }, (metadataJson) => {
    if (!metadataJson) return null;
    try {
      const year = JSON.parse(metadataJson)?.academic_year;
      return typeof year === 'string' && year.trim() ? year.trim() : null;
    } catch {
      return null;
    }
  });
}

// Initialize database
function initializeDatabase() {
  db = new Database(dbPath);
  registerDbFunctions(db);
  // Hard-deleted users must leave their documents and activity log rows
  // behind, and both tables reference users(id). SQLite ships with FK checks
  // off, so state it explicitly instead of inheriting whichever rebuild
  // migration last switched them on for this connection.
  db.pragma('foreign_keys = OFF');
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      middle_name TEXT,
      school_year TEXT,
      program_level TEXT,
      created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS document_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      document_type_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      metadata_json TEXT,
      created_by INTEGER NOT NULL,
      created_by_name TEXT,
      created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (document_type_id) REFERENCES document_types(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      details TEXT,
      created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);');

  // Check if default admin exists
  const adminExists = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
  
  if (adminExists.count === 0) {
    // Create default admin account: username=admin, password=admin123
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run('admin', hashedPassword, 'admin');
    console.log('Default admin account created: username=admin, password=admin123');
  }

  // Check if default regular user exists
  const userExists = db.prepare('SELECT COUNT(*) as count FROM users WHERE username = ?').get('user');
  
  if (userExists.count === 0) {
    // Create default regular user account: username=user, password=user123
    const hashedPassword = bcrypt.hashSync('user123', 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run('user', hashedPassword, 'user');
    console.log('Default regular user account created: username=user, password=user123');
  }

  // Add default student document types if none exist (student-centric model only)
  const docTypesCount = db.prepare('SELECT COUNT(*) as count FROM document_types').get();
  if (docTypesCount.count === 0) {
    const studentDocumentTypes = [
      'Transcript of Records (TOR)',
      'Form 137',
      'Birth Certificate',
      'Clearance',
      'Certificate',
      'Student Form',
      'Application Form',
      'Diploma'
    ];
    
    const insertDocType = db.prepare('INSERT INTO document_types (name) VALUES (?)');
    for (const typeName of studentDocumentTypes) {
      insertDocType.run(typeName);
    }
    console.log(`✓ Initialized ${studentDocumentTypes.length} student document types`);
  }

  // Run migrations to update existing databases
  runMigrations();

  // Q11: one archive root. This writes the shared default (paths.cjs
  // DEFAULT_ARCHIVE_ROOT) when the row is missing or blank and creates that
  // folder. Required lazily: archivePaths requires this module for getDb(), so
  // a load-time require here would close that cycle and hand it an empty
  // exports object.
  require('../services/archivePaths.cjs').ensureArchiveSetting(db);

  console.log('Database initialized at:', dbPath);
}

function closeDatabase() {
  try {
    if (db) {
      db.close();
      db = null;
    }
  } catch (error) {
    console.error('Error closing database on quit:', error);
  }
}

module.exports = {
  getDb,
  setDb,
  registerDbFunctions,
  initializeDatabase,
  closeDatabase
};
