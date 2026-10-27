import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

// Pure module: no electron, no paths.cjs, no database.
const require = createRequire(import.meta.url)
const { resolveArchiveRoot } = require('../../../electron/security/archiveRoot.cjs') as {
  resolveArchiveRoot: (settingValue: unknown, defaultRoot: string | null) => string | null
}

const DEFAULT = 'C:\\Users\\Ana\\AppData\\Roaming\\adzu-registrar-archive\\Archive'

describe('resolveArchiveRoot', () => {
  it('returns a configured value unchanged', () => {
    expect(resolveArchiveRoot('D:\\Registrar Archive', DEFAULT)).toBe('D:\\Registrar Archive')
    expect(resolveArchiveRoot('\\\\fileserver\\records', DEFAULT)).toBe('\\\\fileserver\\records')
  })

  it('trims surrounding whitespace from a configured value', () => {
    expect(resolveArchiveRoot('  D:\\Archive  ', DEFAULT)).toBe('D:\\Archive')
    expect(resolveArchiveRoot('\tD:\\Archive\n', DEFAULT)).toBe('D:\\Archive')
  })

  it('keeps the default when the row is missing', () => {
    expect(resolveArchiveRoot(null, DEFAULT)).toBe(DEFAULT)
    expect(resolveArchiveRoot(undefined, DEFAULT)).toBe(DEFAULT)
  })

  it('keeps the default when the row is empty or whitespace-only', () => {
    expect(resolveArchiveRoot('', DEFAULT)).toBe(DEFAULT)
    expect(resolveArchiveRoot('   ', DEFAULT)).toBe(DEFAULT)
    expect(resolveArchiveRoot('\r\n\t ', DEFAULT)).toBe(DEFAULT)
  })

  it('ignores non-string stored values', () => {
    expect(resolveArchiveRoot(42, DEFAULT)).toBe(DEFAULT)
    expect(resolveArchiveRoot({ path: 'D:\\Archive' }, DEFAULT)).toBe(DEFAULT)
    expect(resolveArchiveRoot(['D:\\Archive'], DEFAULT)).toBe(DEFAULT)
    expect(resolveArchiveRoot(true, DEFAULT)).toBe(DEFAULT)
  })

  it('never turns a blank setting into the process working directory', () => {
    for (const blank of ['', ' ', '\t', '\n', '   \t \n ']) {
      const root = resolveArchiveRoot(blank, DEFAULT)
      expect(root).toBe(DEFAULT)
      expect(root).not.toBe('.')
      expect(root).not.toBe('')
    }
  })

  it('returns the default verbatim, without trimming it', () => {
    expect(resolveArchiveRoot('', ' D:\\default ')).toBe(' D:\\default ')
  })

  it('keeps a bare drive root and trailing separators that the user configured', () => {
    expect(resolveArchiveRoot('C:\\', DEFAULT)).toBe('C:\\')
    expect(resolveArchiveRoot('D:\\Archive\\', DEFAULT)).toBe('D:\\Archive\\')
  })
})
