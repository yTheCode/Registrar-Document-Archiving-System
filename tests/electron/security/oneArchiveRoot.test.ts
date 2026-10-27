import { createRequire } from 'module'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The Q11 fix is about the real modules agreeing, so this file runs them for
// real: a temp userData folder, the real connection/archivePaths/backup code.
// Two things are stood in for:
//   - `electron`, because paths.cjs reads app.getPath('userData') while it
//     loads. It is planted in the CJS cache before the first require, so every
//     module below resolves the same fake and the real app-data folder is
//     never touched.
//   - better-sqlite3, because this tree's copy is built for Electron's ABI and
//     refuses to construct under Node. The handle below implements exactly the
//     two statements the archive code prepares (read the row, upsert the row),
//     so the control flow, trimming and fallbacks tested here are the real
//     ones; the SQL text itself is pinned in archiveRootWiring.test.ts.
const require = createRequire(import.meta.url)

const userData = mkdtempSync(path.join(tmpdir(), 'adzu-one-root-'))
const documents = path.join(userData, 'Documents')
const home = path.join(userData, 'home')
mkdirSync(documents, { recursive: true })
mkdirSync(home, { recursive: true })

const fakeApp = {
  getPath: (name: string) =>
    name === 'userData' ? userData : name === 'documents' ? documents : name === 'home' ? home : path.join(userData, name)
}

const electronEntry = require.resolve('electron')
require.cache[electronEntry] = {
  id: electronEntry,
  filename: electronEntry,
  loaded: true,
  children: [],
  paths: [],
  exports: { app: fakeApp }
} as unknown as NodeModule

const connection = require('../../../electron/db/connection.cjs')
const archivePaths = require('../../../electron/services/archivePaths.cjs')
const backup = require('../../../electron/services/backup.cjs')
const { DEFAULT_ARCHIVE_ROOT } = require('../../../electron/paths.cjs')

const SETTING = 'archive_directory'

const createDb = () => {
  const rows = new Map<string, string>()

  const prepare = (sql: string) => {
    const statement = sql.replace(/\s+/g, ' ').trim()
    if (statement.startsWith('SELECT value FROM settings WHERE key = ?')) {
      return { get: (key: string) => (rows.has(key) ? { value: rows.get(key) } : undefined) }
    }
    if (statement.startsWith('INSERT INTO settings') && statement.includes(SETTING)) {
      // The key is a literal in the statement; the parameters are the value
      // and (on conflict) the same value, so the first one is enough.
      return { run: (value: string) => { rows.set(SETTING, value) } }
    }
    throw new Error(`unexpected SQL in test handle: ${statement}`)
  }

  return { prepare, rows }
}

const readRow = (handle: { rows: Map<string, string> }) => handle.rows.get(SETTING)

let db: ReturnType<typeof createDb>

beforeAll(() => {
  db = createDb()
  connection.setDb(db)
})

afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('one archive root with no setting row (Q11 fallback)', () => {
  it('gives saving, opening, backup and restore the same folder', () => {
    // Saving (imports): ensureArchiveSetting writes the row and makes the folder.
    const savedRoot = archivePaths.ensureArchiveSetting()

    // Opening (stored documents): resolveArchivePath resolves against the same value.
    const storedPath = path.join(savedRoot, 'Transcripts', '2026', 'a.pdf')
    expect(archivePaths.resolveArchivePath(path.join('Transcripts', '2026', 'a.pdf'))).toBe(storedPath)

    // Saving (path recorded in the DB): toArchiveRelative inverts it exactly.
    expect(archivePaths.toArchiveRelative(storedPath)).toBe(path.join('Transcripts', '2026', 'a.pdf'))

    // Copying in: validateAndResolvePath (no renderer root) uses the same value.
    const checked = archivePaths.validateAndResolvePath(storedPath, null)
    expect(checked.valid).toBe(true)
    expect(checked.resolvedRoot).toBe(path.resolve(savedRoot))

    // Backup and the restore probe read through resolveArchiveDir.
    expect(backup.resolveArchiveDir(db)).toBe(savedRoot)

    // ...and they all equal the one default.
    expect(savedRoot).toBe(DEFAULT_ARCHIVE_ROOT)
    expect(archivePaths.getArchiveRoot()).toBe(savedRoot)
    expect(existsSync(savedRoot)).toBe(true)
    expect(readRow(db)).toBe(savedRoot)
  })

  it('never falls back to the working directory or the old Documents folder', () => {
    const root = archivePaths.getArchiveRoot()
    expect(path.resolve(root)).not.toBe(path.resolve(process.cwd()))
    expect(path.relative(documents, path.resolve(root)).startsWith('..')).toBe(true)
  })
})

describe('one archive root with a configured value', () => {
  it('trims the padded setting everywhere and never rewrites it', () => {
    const custom = path.join(userData, 'custom-archive')
    db.rows.set(SETTING, `   ${custom}   `)

    expect(archivePaths.getArchiveRoot()).toBe(custom)
    expect(backup.resolveArchiveDir(db)).toBe(custom)
    expect(archivePaths.ensureArchiveSetting()).toBe(custom)
    expect(readRow(db)).toBe(`   ${custom}   `) // a configured root is left alone

    const inside = archivePaths.validateAndResolvePath(path.join(custom, 'Docs', 'b.pdf'), null)
    expect(inside.valid).toBe(true)
    expect(inside.resolvedRoot).toBe(path.resolve(custom))

    // The default folder is just another folder once a root is configured.
    const outside = archivePaths.validateAndResolvePath(path.join(DEFAULT_ARCHIVE_ROOT, 'Docs', 'b.pdf'), null)
    expect(outside.valid).toBe(false)
  })
})

describe('one archive root with a blank value (the old split)', () => {
  it('repairs the row and resolves to the default in every consumer', () => {
    db.rows.set(SETTING, '   ')

    expect(archivePaths.getArchiveRoot()).toBe(DEFAULT_ARCHIVE_ROOT)
    expect(backup.resolveArchiveDir(db)).toBe(DEFAULT_ARCHIVE_ROOT)

    expect(archivePaths.ensureArchiveSetting()).toBe(DEFAULT_ARCHIVE_ROOT)
    expect(readRow(db)).toBe(DEFAULT_ARCHIVE_ROOT)

    const stored = archivePaths.resolveArchivePath('Docs/c.pdf')
    expect(stored).toBe(path.join(DEFAULT_ARCHIVE_ROOT, 'Docs', 'c.pdf'))
    expect(archivePaths.toArchiveRelative(stored)).toBe(path.join('Docs', 'c.pdf'))
  })
})

describe('one archive root after a restore', () => {
  it("keeps the backup database's own folder when it has one", () => {
    const other = createDb()
    const foreign = path.join(userData, 'from-backup')
    other.rows.set(SETTING, foreign)

    expect(backup.resolveArchiveDir(other)).toBe(foreign)
    expect(archivePaths.ensureArchiveSetting(other)).toBe(foreign)
    expect(readRow(other)).toBe(foreign)
  })

  it('fills a blank backup value with this machine default, not a guess', () => {
    const other = createDb()
    other.rows.set(SETTING, '')

    expect(backup.resolveArchiveDir(other)).toBe(DEFAULT_ARCHIVE_ROOT)
    expect(archivePaths.ensureArchiveSetting(other)).toBe(DEFAULT_ARCHIVE_ROOT)
    expect(readRow(other)).toBe(DEFAULT_ARCHIVE_ROOT)
  })
})
