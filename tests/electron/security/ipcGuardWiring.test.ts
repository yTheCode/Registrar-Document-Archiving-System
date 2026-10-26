import { readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

// Static wiring test for Q6. electron/ipc/*.ipc.cjs and main.cjs cannot be
// required outside Electron (their require chain reaches paths.cjs ->
// app.getPath at module scope), so the coverage rule is pinned by reading the
// sources: every handler must be registered while ipc/index.cjs's guarded
// ipcMain.handle is installed, and nothing else may register one.
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const readElectron = (relative: string) => read(`../../../electron/${relative}`)

const IPC_DIR = new URL('../../../electron/ipc/', import.meta.url)
const ELECTRON_DIR = new URL('../../../electron/', import.meta.url)

const modules = readdirSync(IPC_DIR)
  .filter(name => name.endsWith('.ipc.cjs'))
  .sort()

const index = readElectron('ipc/index.cjs')
const main = readElectron('main.cjs')

const registered = [...index.matchAll(/require\('\.\/([^']+\.ipc\.cjs)'\)/g)].map(m => m[1])
const CHANNEL = /ipcMain\.handle\(\s*'([^']+)'/g

function walk(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
    return entry.isDirectory() ? walk(child) : [child]
  })
}

const electronSources = walk(ELECTRON_DIR).filter(url => /\.(cjs|js)$/.test(url.pathname))
const filesOutsideIpc = electronSources.filter(url => !url.pathname.includes('/ipc/'))
const relative = (url: URL) => fileURLToPath(url).replace(fileURLToPath(ELECTRON_DIR), '').replace(/\\/g, '/')

describe('ipc/index.cjs guarded registration (Q6)', () => {
  it('installs the guard before the first module is required and restores it after the last', () => {
    const swapAt = index.indexOf('ipcMain.handle = function guardedHandle')
    const restoreAt = index.indexOf('ipcMain.handle = handle')
    expect(swapAt).toBeGreaterThan(-1)
    expect(restoreAt).toBeGreaterThan(swapAt)

    const requireAt = registered.map(file => index.indexOf(`require('./${file}')`))
    expect(requireAt[0]).toBeGreaterThan(swapAt)
    expect(requireAt[requireAt.length - 1]).toBeLessThan(restoreAt)
  })

  it('denies through the guard before the handler body runs', () => {
    const denyAt = index.indexOf("error: 'Permission denied'")
    const bodyAt = index.indexOf('listener(event, ...args)')
    expect(denyAt).toBeGreaterThan(-1)
    expect(index).toContain("{ success: false, error: 'Permission denied' }")
    expect(denyAt).toBeLessThan(bodyAt)
  })

  it('fails closed when no validator is passed in', () => {
    expect(index).toContain("typeof validateSender !== 'function' || !validateSender(event)")
    expect(index).toContain('every IPC call will be denied')
  })

  it('requires every *.ipc.cjs module exactly once', () => {
    expect(modules.length).toBeGreaterThan(0)
    for (const file of modules) {
      expect(registered.filter(name => name === file)).toHaveLength(1)
    }
    expect(registered).toHaveLength(modules.length)
  })
})

describe('handler registration coverage (Q6)', () => {
  it('no module outside electron/ipc registers a handler', () => {
    for (const file of filesOutsideIpc) {
      const source = readFileSync(file, 'utf8')
      expect(`${relative(file)}: ${/ipcMain\.(handle|handleOnce|on|once)\s*\(/.test(source)}`).toBe(
        `${relative(file)}: false`
      )
    }
  })

  it('no file outside ipc/index.cjs requires a handler module', () => {
    for (const file of filesOutsideIpc) {
      const source = readFileSync(file, 'utf8')
      expect(`${relative(file)}: ${/require\([^)]*\.ipc\.cjs/.test(source)}`).toBe(`${relative(file)}: false`)
    }
  })

  it('channel names are unique across the modules', () => {
    const channels = modules.flatMap(file =>
      [...read(`../../../electron/ipc/${file}`).matchAll(CHANNEL)].map(m => m[1])
    )
    expect(channels).toHaveLength(47)
    expect(new Set(channels).size).toBe(channels.length)
  })
})

describe('main.cjs wiring (Q6)', () => {
  it('builds the guard from the main window and the URL policy, and passes it in', () => {
    expect(main).toContain("require('./security/senderGuard.cjs')")
    expect(main).toContain('registerAllIpc({ validateSender })')
    expect(main).toContain('createSenderGuard({')
    expect(main).toContain('getMainWindow()')
    expect(main).toContain('createUrlPolicy({')
    expect(main).toContain('pathToFileURL(INDEX_HTML_PATH).href')
  })

  it('allows the dev origin only when the window is loaded from the dev server', () => {
    expect(main).toContain("require('./security/runtimeMode.cjs')")
    expect(main).toContain('resolveRuntimeMode({ isPackaged: app.isPackaged })')
    expect(main).toContain('devServerOrigin: devServerUrl')
    expect(main).toContain('mainWindow.loadURL(devServerUrl)')
    expect(main).toContain('mainWindow.loadFile(INDEX_HTML_PATH)')
  })

  it('does not let the environment choose dev mode (Q1)', () => {
    expect(main).not.toContain('NODE_ENV')
    expect(main).not.toContain('usesDevServer')
  })
})
