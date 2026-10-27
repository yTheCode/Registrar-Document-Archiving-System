import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

// files.ipc.cjs cannot be required outside Electron (require chain reaches
// paths.cjs -> app.getPath), and the print window itself is a live
// BrowserWindow, so Q4 is pinned at the source level.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const files = read('../../../electron/ipc/files.ipc.cjs')

const printWindowBlock = () => {
  const start = files.indexOf('const printWindow = new BrowserWindow({')
  expect(start).toBeGreaterThan(-1)
  const end = files.indexOf('});', start)
  expect(end).toBeGreaterThan(start)
  return files.slice(start, end)
}

describe('hidden print window (Q4)', () => {
  it('is created without a preload', () => {
    expect(printWindowBlock()).not.toContain('preload')
  })

  it('does not import the app preload path at all', () => {
    expect(files).not.toContain('PRELOAD_PATH')
  })

  it('keeps the renderer locked down', () => {
    const block = printWindowBlock()
    expect(block).toContain('sandbox: true')
    expect(block).toContain('nodeIntegration: false')
    expect(block).toContain('contextIsolation: true')
  })

  it('loads a generated page that talks to no bridge', () => {
    // The page is the HTML template written just above the window, plus the
    // loadFile call it is loaded with.
    expect(files).toContain('<img src="${pathToFileURL(resolvedPath).href}" alt="">')
    expect(files).not.toContain('electronAPI')
    expect(files).not.toMatch(/<script/i)
    expect(files).toContain('printWindow.loadFile(htmlPath)')
  })
})
