import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

// Pure module: no electron, no paths.cjs, so it loads in plain Node.
const require = createRequire(import.meta.url)
const { normalizePickedPath, isPickedPath } = require('../../../electron/security/pickedFiles.cjs') as {
  normalizePickedPath: (value: unknown, options?: { platform?: string }) => string | null
  isPickedPath: (sourcePath: unknown, pickedPaths: Iterable<unknown> | null, options?: { platform?: string }) => boolean
}

const WIN = { platform: 'win32' }
const PICKED = 'C:\\Users\\Ana\\Docs\\file.pdf'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('normalizePickedPath (win32)', () => {
  it('returns an absolute, lower-cased path', () => {
    expect(normalizePickedPath(PICKED, WIN)).toBe('c:\\users\\ana\\docs\\file.pdf')
  })

  it('collapses forward slashes, dot segments and redundant separators', () => {
    expect(normalizePickedPath('C:/Users//Ana/Docs/../Docs/file.pdf', WIN)).toBe('c:\\users\\ana\\docs\\file.pdf')
    expect(normalizePickedPath('c:\\Users\\Ana\\.\\Docs\\file.pdf', WIN)).toBe('c:\\users\\ana\\docs\\file.pdf')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizePickedPath('  C:\\a.txt\t', WIN)).toBe('c:\\a.txt')
  })

  it('returns null for anything that is not a usable path', () => {
    expect(normalizePickedPath('', WIN)).toBeNull()
    expect(normalizePickedPath('   ', WIN)).toBeNull()
    expect(normalizePickedPath('\n\t', WIN)).toBeNull()
    expect(normalizePickedPath(null, WIN)).toBeNull()
    expect(normalizePickedPath(undefined, WIN)).toBeNull()
    expect(normalizePickedPath(42, WIN)).toBeNull()
    expect(normalizePickedPath({ path: PICKED }, WIN)).toBeNull()
    expect(normalizePickedPath('C:\\a\0b.txt', WIN)).toBeNull()
  })

  it('returns null for relative paths instead of resolving them', () => {
    expect(normalizePickedPath('file.pdf', WIN)).toBeNull()
    expect(normalizePickedPath('.\\Docs\\file.pdf', WIN)).toBeNull()
    expect(normalizePickedPath('C:file.pdf', WIN)).toBeNull()
  })

  it('does not fold case on a case-sensitive platform', () => {
    expect(normalizePickedPath('/home/Ana/File.pdf', { platform: 'linux' })).toBe('/home/Ana/File.pdf')
  })
})

describe('isPickedPath (win32)', () => {
  it('accepts the exact picked path', () => {
    expect(isPickedPath(PICKED, new Set([PICKED]), WIN)).toBe(true)
  })

  it('accepts the same file with different casing', () => {
    expect(isPickedPath('c:\\users\\ana\\docs\\FILE.PDF', new Set([PICKED]), WIN)).toBe(true)
    expect(isPickedPath(PICKED, new Set(['C:\\USERS\\ANA\\DOCS\\FILE.pdf']), WIN)).toBe(true)
  })

  it('accepts the same file written with mixed slashes', () => {
    expect(isPickedPath('C:/Users/Ana/Docs/file.pdf', new Set([PICKED]), WIN)).toBe(true)
    expect(isPickedPath(PICKED, new Set(['C:/Users\\Ana/Docs/file.pdf']), WIN)).toBe(true)
  })

  it('rejects any relative source, even one that would resolve to the picked file', () => {
    // The answer must not depend on the process working directory.
    const picked = new Set([PICKED])
    expect(isPickedPath('file.pdf', picked, WIN)).toBe(false)
    expect(isPickedPath('.\\file.pdf', picked, WIN)).toBe(false)
    expect(isPickedPath('..\\Other\\file.pdf', picked, WIN)).toBe(false)
    expect(isPickedPath('Docs\\file.pdf', picked, WIN)).toBe(false)
  })

  it('rejects a different file', () => {
    expect(isPickedPath('C:\\Users\\Ana\\Docs\\other.pdf', new Set([PICKED]), WIN)).toBe(false)
  })

  it('rejects traversal to a system file', () => {
    expect(isPickedPath('..\\..\\Windows\\System32\\config\\SAM', new Set([PICKED]), WIN)).toBe(false)
    expect(isPickedPath('C:\\Windows\\System32\\config\\SAM', new Set([PICKED]), WIN)).toBe(false)
  })

  it('rejects the database and the app folder', () => {
    expect(isPickedPath('C:\\Users\\Ana\\AppData\\Roaming\\adzu-registrar-archive\\database\\registrar_archive.db', new Set([PICKED]), WIN)).toBe(false)
    expect(isPickedPath('C:\\work\\electron\\main.cjs', new Set([PICKED]), WIN)).toBe(false)
  })

  it('rejects a UNC path that was not picked, and accepts one that was', () => {
    const unc = '\\\\fileserver\\records\\file.pdf'
    expect(isPickedPath(unc, new Set([PICKED]), WIN)).toBe(false)
    expect(isPickedPath('//fileserver/records/file.pdf', new Set([unc]), WIN)).toBe(true)
  })

  it('does not equate a long-path prefixed name with the plain path', () => {
    // Fail-closed: \\?\C:\... is a distinct string today, so it is not matched.
    expect(isPickedPath('\\\\?\\C:\\Users\\Ana\\Docs\\file.pdf', new Set([PICKED]), WIN)).toBe(false)
  })

  it('rejects empty, blank and non-string sources', () => {
    const picked = new Set([PICKED])
    expect(isPickedPath('', picked, WIN)).toBe(false)
    expect(isPickedPath('   ', picked, WIN)).toBe(false)
    expect(isPickedPath(null, picked, WIN)).toBe(false)
    expect(isPickedPath(undefined, picked, WIN)).toBe(false)
    expect(isPickedPath(7, picked, WIN)).toBe(false)
  })

  it('rejects everything when nothing has been picked', () => {
    expect(isPickedPath(PICKED, new Set(), WIN)).toBe(false)
    expect(isPickedPath(PICKED, null, WIN)).toBe(false)
    expect(isPickedPath(PICKED, undefined, WIN)).toBe(false)
  })

  it('ignores unusable entries in the picked set', () => {
    expect(isPickedPath(PICKED, new Set([null, undefined, 42, '', PICKED]), WIN)).toBe(true)
    expect(isPickedPath('C:\\other.pdf', new Set([null, undefined, 42, '']), WIN)).toBe(false)
  })

  it('keeps case-sensitive membership on a case-sensitive platform', () => {
    const posix = { platform: 'linux' }
    expect(isPickedPath('/home/ana/File.pdf', new Set(['/home/ana/File.pdf']), posix)).toBe(true)
    expect(isPickedPath('/home/ana/file.pdf', new Set(['/home/ana/File.pdf']), posix)).toBe(false)
    expect(isPickedPath('home/ana/File.pdf', new Set(['/home/ana/File.pdf']), posix)).toBe(false)
  })
})

describe('file:copy wiring (Q3)', () => {
  const files = read('../../../electron/ipc/files.ipc.cjs')

  const copyHandler = () => {
    const start = files.indexOf("ipcMain.handle('file:copy'")
    expect(start).toBeGreaterThan(-1)
    const end = files.indexOf("ipcMain.handle('file:openExternal'", start)
    expect(end).toBeGreaterThan(start)
    return files.slice(start, end)
  }

  it('imports the pure matcher', () => {
    expect(files).toContain("const { isPickedPath } = require('../security/pickedFiles.cjs');")
  })

  it('keeps the channel signature and payload', () => {
    expect(copyHandler()).toContain("ipcMain.handle('file:copy', async (event, { sourcePath, destPath }) => {")
  })

  it('checks the source against the picked set before touching any file', () => {
    const handler = copyHandler()
    const check = handler.indexOf('isPickedPath(sourcePath, sessionPickedFiles)')
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(handler.indexOf('validateAndResolvePath('))
    expect(check).toBeLessThan(handler.indexOf('copyFileSync('))
  })

  it('returns the ordinary failure shape with the dialog message', () => {
    const handler = copyHandler()
    expect(handler).toContain(
      "return { success: false, error: 'Only files chosen in the Open dialog can be imported.' };"
    )
  })

  it('keeps the destination checks it had before', () => {
    const handler = copyHandler()
    expect(handler).toContain('validateAndResolvePath(destPath, archiveRoot)')
    expect(handler).toContain('Security: ${validation.error}')
    expect(handler).toContain('fs.copyFileSync(sourcePath, validation.resolvedPath);')
  })
})
