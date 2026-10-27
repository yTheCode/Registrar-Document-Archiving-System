import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

// archivePaths.cjs cannot be required outside Electron (its require chain
// reaches paths.cjs -> app.getPath), so the wiring of Q11 is pinned at the
// source level, as the other P1A/P1B wiring tests do.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const url = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

const paths = read('../../../electron/paths.cjs')
const archivePaths = read('../../../electron/services/archivePaths.cjs')
const backupService = read('../../../electron/services/backup.cjs')
const connection = read('../../../electron/db/connection.cjs')
const filesIpc = read('../../../electron/ipc/files.ipc.cjs')
const imagesIpc = read('../../../electron/ipc/images.ipc.cjs')
const backupIpc = read('../../../electron/ipc/backup.ipc.cjs')
const settingsIpc = read('../../../electron/ipc/settings.ipc.cjs')
const migrations = read('../../../electron/services/archiveMigrations.cjs')
const folderNaming = read('../../../electron/services/folderNaming.cjs')
const importPage = read('../../../src/features/import-scanner/components/ImportScannerPage.tsx')
const bridgeTypes = read('../../../src/types/electron.d.ts')

describe('one default archive root', () => {
  it('is defined once, in paths.cjs, beside the database', () => {
    expect(paths).toContain("const DEFAULT_ARCHIVE_ROOT = path.join(userDataPath, 'Archive');")
    expect(paths.match(/DEFAULT_ARCHIVE_ROOT/g)).toHaveLength(2) // definition + export
    expect(paths).toMatch(/module\.exports = \{[\s\S]*DEFAULT_ARCHIVE_ROOT,[\s\S]*\};/)
  })

  it('is the only place that spells the default folder name', () => {
    const electronFiles = readdirSync(url('../../../electron'), { recursive: true })
      .map(String)
      .filter((name) => name.endsWith('.cjs') || name.endsWith('.js'))
    const offenders = electronFiles.filter(
      (name) =>
        name !== 'paths.cjs' &&
        /path\.join\((?:userDataPath|app\.getPath\('documents'\)),\s*'Archive'\)/.test(
          readFileSync(url(`../../../electron/${name.replace(/\\/g, '/')}`), 'utf8')
        )
    )
    expect(offenders).toEqual([])
  })

  it('is not duplicated anywhere in the old Documents spelling', () => {
    for (const source of [archivePaths, backupService, connection, filesIpc, imagesIpc, migrations, folderNaming]) {
      expect(source).not.toContain('ADZU_Archive')
    }
    expect(importPage).not.toContain('ADZU_Archive')
  })
})

describe('getArchiveRoot and ensureArchiveSetting (archivePaths.cjs)', () => {
  it('resolves the trimmed setting, then the shared default', () => {
    expect(archivePaths).toContain(
      'return resolveArchiveRoot(readArchiveSetting(handle || getDb()), DEFAULT_ARCHIVE_ROOT);'
    )
    expect(archivePaths).toContain("const { DEFAULT_ARCHIVE_ROOT } = require('../paths.cjs');")
    expect(archivePaths).toContain("const { resolveArchiveRoot } = require('../security/archiveRoot.cjs');")
  })

  it('accepts a handle at the end and still works with no argument', () => {
    expect(archivePaths).toContain('function getArchiveRoot(handle) {')
    expect(archivePaths).toContain('function ensureArchiveSetting(handle) {')
  })

  it('writes the default only when the row is missing or blank', () => {
    expect(archivePaths).toContain("if (typeof value !== 'string' || !value.trim()) {")
    expect(archivePaths).toContain('ON CONFLICT(key) DO UPDATE SET value = ?')
    // The insert lives inside that branch: it must not run for a real value.
    const guard = archivePaths.indexOf("if (typeof value !== 'string' || !value.trim()) {")
    const insert = archivePaths.indexOf("INSERT INTO settings (key, value, updated_at)")
    expect(guard).toBeGreaterThan(-1)
    expect(insert).toBeGreaterThan(guard)
  })

  it('creates the default folder on disk', () => {
    expect(archivePaths).toContain('fs.mkdirSync(root, { recursive: true });')
  })

  it('exports both functions', () => {
    expect(archivePaths).toMatch(
      /module\.exports = \{ validateAndResolvePath, getArchiveRoot, ensureArchiveSetting, resolveArchivePath, toArchiveRelative \};/
    )
  })

  it('no longer needs electron for its fallbacks', () => {
    expect(archivePaths).not.toContain("require('electron')")
    expect(archivePaths).not.toContain("getPath('documents')")
    expect(archivePaths).toContain('const configuredRoot = resolveArchiveRoot(archiveRoot, null);')
    expect(archivePaths).toContain('const resolvedRoot = path.resolve(configuredRoot || getArchiveRoot());')
  })
})

describe('every consumer uses the shared root', () => {
  it('file:copy reads getArchiveRoot() instead of the setting', () => {
    expect(filesIpc).toContain('const archiveRoot = getArchiveRoot();')
    expect(filesIpc).not.toContain("get('archive_directory')")
  })

  it('image:saveBase64 reads getArchiveRoot() instead of the setting', () => {
    expect(imagesIpc).toContain('const archiveRoot = getArchiveRoot();')
    expect(imagesIpc).not.toContain("get('archive_directory')")
    expect(imagesIpc).not.toContain("require('electron').app")
    expect(imagesIpc).not.toMatch(/\bapp\.getPath/)
  })

  it('the startup folder migration reads getArchiveRoot()', () => {
    expect(migrations).toContain('const archiveRoot = getArchiveRoot();')
    expect(migrations).not.toContain("get('archive_directory')")
  })

  it('backup and restore resolve the root with the same rule', () => {
    expect(backupService).toContain('return resolveArchiveRoot(row?.value, DEFAULT_ARCHIVE_ROOT);')
    expect(backupService).not.toContain("path.join(userDataPath, 'Archive')")
    expect(backupIpc).toContain('const archiveDir = resolveArchiveDir(getDb());')
  })

  it('folder naming falls back to the shared root for a blank renderer value', () => {
    expect(folderNaming).toContain('resolveArchiveRoot(archiveRoot, null) || getArchiveRoot()')
  })
})

describe('startup and restore keep the setting present', () => {
  it('database initialization calls ensureArchiveSetting lazily (no require cycle)', () => {
    expect(connection).toContain("require('../services/archivePaths.cjs').ensureArchiveSetting(db);")
    expect(connection).not.toMatch(/^const .*archivePaths/m)
    expect(connection).not.toContain("INSERT INTO settings (key, value) VALUES (?, ?)")
  })

  it('backup:restore calls it after every runMigrations()', () => {
    const migrationsCalls = [...backupIpc.matchAll(/runMigrations\(\);/g)].map((m) => m.index ?? -1)
    const ensureCalls = [...backupIpc.matchAll(/ensureArchiveSetting\(\);/g)].map((m) => m.index ?? -1)
    expect(migrationsCalls).toHaveLength(2)
    expect(ensureCalls).toHaveLength(2)
    expect(ensureCalls[0]).toBeGreaterThan(migrationsCalls[0])
    expect(ensureCalls[1]).toBeGreaterThan(migrationsCalls[1])
  })
})

describe('settings:set refuses the archive root', () => {
  it('rejects the key with a message that names the supported route', () => {
    expect(settingsIpc).toContain("if (key === 'archive_directory') {")
    expect(settingsIpc).toContain('Settings → Archive Location')
    expect(settingsIpc).toContain('moves or re-points the archived files')
  })

  it('checks the key after the admin check and before the write', () => {
    const admin = settingsIpc.indexOf('if (!await isAdmin(userId))')
    const refusal = settingsIpc.indexOf("if (key === 'archive_directory')")
    const write = settingsIpc.indexOf('INSERT INTO settings')
    expect(admin).toBeGreaterThan(-1)
    expect(refusal).toBeGreaterThan(admin)
    expect(write).toBeGreaterThan(refusal)
  })
})

describe('renderer no longer invents a root', () => {
  it('passes the setting value as-is', () => {
    expect(importPage).toContain('const archiveDir = archiveResult.value')
    expect(importPage).not.toContain("archiveResult.value || 'Archive'")
  })

  it('accepts null for the archive root in the bridge types', () => {
    expect(bridgeTypes).toMatch(/archiveRoot: string \| null/)
  })
})

// settings:set now refuses archive_directory (the files and the row would
// disagree), so no renderer file may use that route, and nothing may call
// setSetting at all. Settings.tsx changes the root only through
// archive:changeDirectory, which validates the target and moves or re-points
// the files.
const rendererFiles = () =>
  readdirSync(url('../../../src'), { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => {
      const file = name.replace(/\\/g, '/')
      return { name: file, text: read(`../../../src/${file}`) }
    })

const rendererCalls = (pattern: RegExp) =>
  rendererFiles()
    .filter((file) => file.name !== 'types/electron.d.ts')
    .filter((file) => pattern.test(file.text))
    .map((file) => file.name)

describe('renderer cannot write the archive setting', () => {
  it('reads archive_directory only through getSetting', () => {
    const refs = rendererFiles().filter((file) => file.text.includes('archive_directory'))
    expect(refs.map((file) => file.name).sort()).toEqual([
      'features/import-scanner/components/ImportScannerPage.tsx',
      'pages/Settings.tsx'
    ])
    for (const file of refs) {
      const uses = file.text.match(/archive_directory/g) ?? []
      const reads = file.text.match(/getSetting\('archive_directory'\)/g) ?? []
      expect(reads).toHaveLength(uses.length)
    }
  })

  it('calls no setSetting at all, though the bridge still offers it', () => {
    expect(rendererCalls(/\bsetSetting\s*\(/)).toEqual([])
    expect(bridgeTypes).toContain('setSetting(key: string, value: string, userId: number)')
  })

  it('changes the root only through archive:changeDirectory', () => {
    expect(rendererCalls(/\bchangeArchiveDirectory\s*\(/)).toEqual(['pages/Settings.tsx'])
  })
})
