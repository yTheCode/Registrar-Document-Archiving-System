// Schema migrations for the live database handle. runMigrations() is called
// from initializeDatabase() and again after a backup restore reopens the
// handle, so both functions read the CURRENT handle at call time (a
// module-level capture would go stale after a restore). The require of
// ./connection.cjs is function-scoped on purpose: connection.cjs requires
// this module at load time, and requiring the other way at load time would
// complete a cycle with partial exports.

// Run migrations to ensure database schema is up to date
function runMigrations() {
  const db = require('./connection.cjs').getDb();
  console.log('Running database migrations...');
  
  // Migration: Add metadata_json column to documents table if missing
  const documentsColumns = db.prepare("PRAGMA table_info(documents)").all();
  const hasMetadataJson = documentsColumns.some(col => col.name === 'metadata_json');
  
  if (!hasMetadataJson) {
    console.log('Adding metadata_json column to documents table...');
    db.exec('ALTER TABLE documents ADD COLUMN metadata_json TEXT');
    console.log('✓ Added metadata_json column');
  }

  // Users are hard-deleted now (see users:delete), but earlier builds only
  // stamped deleted_at. Those rows still show up in the user list with no way
  // to remove them, so purge them once on startup. Activity logs keep their
  // reference and fall back to the 'Deleted User' label like any other
  // hard-deleted account.
  const usersColumns = db.prepare("PRAGMA table_info(users)").all();

  if (!usersColumns.some(col => col.name === 'deleted_at')) {
    console.log('Adding deleted_at column to users table...');
    db.exec('ALTER TABLE users ADD COLUMN deleted_at TEXT');
    console.log('✓ Added deleted_at column');
  }

  if (usersColumns.some(col => col.name === 'deleted_at')) {
    const legacy = db.prepare('SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NOT NULL').get().count;
    if (legacy > 0) {
      const removed = db.prepare('DELETE FROM users WHERE deleted_at IS NOT NULL').run();
      console.log(`✓ Purged ${removed.changes} legacy soft-deleted user account(s)`);
    }
  }
  // Migration: Add school_year and program_level columns to students table if missing
  const studentsColumns = db.prepare("PRAGMA table_info(students)").all();

  if (!studentsColumns.some(col => col.name === 'school_year')) {
    console.log('Adding school_year column to students table...');
    db.exec('ALTER TABLE students ADD COLUMN school_year TEXT');
    console.log('✓ Added school_year column');
  }

  if (!studentsColumns.some(col => col.name === 'program_level')) {
    console.log('Adding program_level column to students table...');
    db.exec('ALTER TABLE students ADD COLUMN program_level TEXT');
    console.log('✓ Added program_level column');
  }

  // Migration: Add deleted_at to students so deletion is a soft-delete into a
  // recycle bin (the row and its documents stay intact and can be restored).
  if (!studentsColumns.some(col => col.name === 'deleted_at')) {
    console.log('Adding deleted_at column to students table...');
    db.exec('ALTER TABLE students ADD COLUMN deleted_at TEXT');
    console.log('✓ Added deleted_at column');
  }

  // Migration: standardize the program level terminology. "Graduate" and
  // "Masters" were the same category under two names; both become the single
  // standard term "Graduate School" so filters and folder lookups stay
  // consistent. Idempotent — after the first run no rows match.
  const renamedLevels = db.prepare(
    "UPDATE students SET program_level = 'Graduate School' WHERE program_level IN ('Graduate', 'Masters')"
  ).run();
  if (renamedLevels.changes > 0) {
    console.log(`✓ Standardized ${renamedLevels.changes} student program level(s) to 'Graduate School'`);
  }

  // Migration: relax NOT NULL on students.student_id (SQLite can't ALTER a
  // column constraint, so rebuild the table)
  const studentIdCol = db.prepare("PRAGMA table_info(students)").all().find(col => col.name === 'student_id');
  if (studentIdCol && studentIdCol.notnull === 1) {
    console.log('Rebuilding students table to make student_id nullable...');
    rebuildTable(
      'students',
      STUDENTS_TABLE_SCHEMA,
      `SELECT id, student_id, first_name, last_name, middle_name, school_year, program_level, created_at, deleted_at FROM students`
    );
    console.log('✓ students.student_id is now nullable');
  }

  // Migration: drop the legacy naming_templates and folder_structures tables
  // plus the document_types columns they fed. File naming now derives from the
  // document type name, and nothing has read these since the dead IPC
  // handlers were removed.
  const legacyTables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('naming_templates', 'folder_structures')"
  ).all();
  if (legacyTables.length > 0) {
    console.log('Dropping legacy tables:', legacyTables.map(t => t.name).join(', '));
    db.exec('DROP TABLE IF EXISTS naming_templates');
    db.exec('DROP TABLE IF EXISTS folder_structures');
    console.log('✓ Dropped legacy tables');
  }

  const docTypeColumns = db.prepare("PRAGMA table_info(document_types)").all();
  for (const col of ['default_folder_path', 'naming_template_id']) {
    if (docTypeColumns.some(c => c.name === col)) {
      console.log(`Dropping legacy column document_types.${col}...`);
      db.exec(`ALTER TABLE document_types DROP COLUMN ${col}`);
      console.log(`✓ Dropped legacy column document_types.${col}`);
    }
  }

  // Migration: drop document_type_fields (FK into metadata_fields) then
  // metadata_fields — these tables are no longer used.
  const obsoleteTables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('document_type_fields', 'metadata_fields')"
  ).all().map(t => t.name);
  if (obsoleteTables.includes('document_type_fields')) {
    console.log('Dropping obsolete table: document_type_fields');
    db.exec('DROP TABLE document_type_fields');
    console.log('✓ Dropped document_type_fields');
  }
  if (obsoleteTables.includes('metadata_fields')) {
    console.log('Dropping obsolete table: metadata_fields');
    db.exec('DROP TABLE metadata_fields');
    console.log('✓ Dropped metadata_fields');
  }

  // Migration: drop document_types.status and document_types.updated_at
  const freshDocTypeColumns = db.prepare("PRAGMA table_info(document_types)").all();
  for (const col of ['status', 'updated_at']) {
    if (freshDocTypeColumns.some(c => c.name === col)) {
      console.log(`Dropping column document_types.${col}...`);
      db.exec(`ALTER TABLE document_types DROP COLUMN ${col}`);
      console.log(`✓ Dropped document_types.${col}`);
    }
  }

  // Migration: Add deleted_at column to documents table for soft-delete support
  const documentsColumnsCheck = db.prepare("PRAGMA table_info(documents)").all();
  if (!documentsColumnsCheck.some(col => col.name === 'deleted_at')) {
    console.log('Adding deleted_at column to documents table...');
    db.exec('ALTER TABLE documents ADD COLUMN deleted_at TEXT');
    console.log('✓ Added deleted_at column to documents');
  }

  // Migration: stamp the archiving user's name onto every document. Accounts are
  // hard-deleted, so the join to users cannot be the source of the credit — the
  // row has to carry the name itself. Backfilling runs only when the column is
  // first added; after that each insert writes its own value.
  if (!documentsColumnsCheck.some(col => col.name === 'created_by_name')) {
    console.log('Adding created_by_name column to documents table...');
    db.exec('ALTER TABLE documents ADD COLUMN created_by_name TEXT');
    db.prepare(`
      UPDATE documents
      SET created_by_name = (SELECT username FROM users WHERE users.id = documents.created_by)
      WHERE created_by_name IS NULL AND created_by IS NOT NULL
    `).run();
    db.prepare("UPDATE documents SET created_by_name = 'Deleted User' WHERE created_by_name IS NULL").run();
    console.log('✓ Added and backfilled created_by_name column');
  }

  // Create index on documents.deleted_at for recycle bin queries
  const indexExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_documents_deleted'"
  ).get();
  if (!indexExists) {
    console.log('Creating index on documents.deleted_at...');
    db.exec('CREATE INDEX idx_documents_deleted ON documents(deleted_at)');
    console.log('✓ Created index idx_documents_deleted');
  }

  // Migration: Drop requires_student_info column (now always student-centric)
  const docTypeColumnsCheck = db.prepare("PRAGMA table_info(document_types)").all();
  if (docTypeColumnsCheck.some(col => col.name === 'requires_student_info')) {
    console.log('Dropping requires_student_info column from document_types table...');
    db.exec('ALTER TABLE document_types DROP COLUMN requires_student_info');
    console.log('✓ Dropped requires_student_info column');
  }

  // Migration: Drop category column (all document types are student-centric by design)
  const docTypeCategoryCheck = db.prepare("PRAGMA table_info(document_types)").all();
  if (docTypeCategoryCheck.some(col => col.name === 'category')) {
    console.log('Dropping category column from document_types table...');
    db.exec('ALTER TABLE document_types DROP COLUMN category');
    console.log('✓ Dropped category column');
  }

  // Migration: drop students.updated_at (requires a table rebuild in SQLite
  // because it carries a DEFAULT constraint that prevents simple DROP COLUMN
  // on some SQLite versions, and to be fully safe we use the rename pattern).
  const studentsColsCheck = db.prepare("PRAGMA table_info(students)").all();
  if (studentsColsCheck.some(col => col.name === 'updated_at')) {
    console.log('Rebuilding students table to drop updated_at...');
    rebuildTable(
      'students',
      STUDENTS_TABLE_SCHEMA,
      `SELECT id, student_id, first_name, last_name, middle_name, school_year, program_level, created_at, deleted_at FROM students`
    );
    console.log('✓ Dropped students.updated_at');
  }

  console.log('Database migrations complete');
}

const STUDENTS_TABLE_SCHEMA = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  middle_name TEXT,
  school_year TEXT,
  program_level TEXT,
  created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
`;

function rebuildTable(tableName, newSchema, insertSelect) {
  const db = require('./connection.cjs').getDb();
  const tempName = `${tableName}_new`;
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE ${tempName} (${newSchema});
    INSERT INTO ${tempName} ${insertSelect};
    DROP TABLE ${tableName};
    ALTER TABLE ${tempName} RENAME TO ${tableName};
  `);
  // Leave checks off: this connection runs with them off on purpose (see
  // initializeDatabase), and switching them back on here would make the first
  // hard-deleted user of the session fail on its documents and log rows.
  db.pragma('foreign_keys = OFF');
}

module.exports = {
  runMigrations,
  rebuildTable,
  STUDENTS_TABLE_SCHEMA
};
