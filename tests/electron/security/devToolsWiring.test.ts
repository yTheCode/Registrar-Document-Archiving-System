import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

// These two files cannot be required outside Electron (their require chain
// reaches paths.cjs), so the wiring is pinned at the source level, the same way
// tests/electron/security/authWiring.test.ts and ipcGuardWiring.test.ts do it.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const main = read('../../../electron/main.cjs')
const files = read('../../../electron/ipc/files.ipc.cjs')

describe('DevTools and menu wiring (Q2)', () => {
  it('takes the DevTools switch from the one runtime decision', () => {
    expect(main).toContain('resolveRuntimeMode({ isPackaged: app.isPackaged })')
    expect(main).toContain('const { isDev, devServerUrl, devTools } =')
  })

  it('passes the switch into the main window webPreferences', () => {
    const webPreferences = main.slice(main.indexOf('webPreferences: {'))
    expect(webPreferences.slice(0, 200)).toContain('devTools,')
  })

  it('removes the menu and swallows the DevTools/reload shortcuts when packaged', () => {
    expect(main).toContain('if (!isDev) {')
    expect(main).toContain('Menu.setApplicationMenu(null)')
    expect(main).toContain("mainWindow.webContents.on('before-input-event'")
    expect(main).toContain('if (isBlockedShortcut(input)) event.preventDefault()')

    // Both guards live inside the packaged-only branch.
    const branch = main.indexOf('if (!isDev) {')
    expect(branch).toBeGreaterThan(-1)
    expect(main.indexOf('Menu.setApplicationMenu(null)')).toBeGreaterThan(branch)
    expect(main.indexOf('before-input-event')).toBeGreaterThan(branch)
  })

  it('keeps DevTools available to developers outside that branch', () => {
    expect(main).toContain('if (devTools) mainWindow.webContents.openDevTools()')
  })

  it('gives the hidden print window the same DevTools setting', () => {
    expect(files).toContain('resolveRuntimeMode({ isPackaged: app.isPackaged })')
    const printWindow = files.slice(files.indexOf('const printWindow = new BrowserWindow({'))
    expect(printWindow.slice(0, 400)).toContain('devTools,')
  })
})
