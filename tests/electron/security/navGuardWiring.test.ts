import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

// main.cjs cannot be required outside Electron, so the Q7 wiring is pinned at
// the source level (same approach as the other wiring tests in this folder).
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const main = read('../../../electron/main.cjs')
const createWindow = () => {
  const start = main.indexOf('function createWindow() {')
  expect(start).toBeGreaterThan(-1)
  return main.slice(start, main.indexOf('\n}', start))
}

describe('navigation, pop-up and permission wiring (Q7)', () => {
  it('denies every window.open', () => {
    expect(createWindow()).toContain('mainWindow.webContents.setWindowOpenHandler(() => DENY_WINDOW_OPEN)')
    expect(main).toContain("require('./security/navGuard.cjs')")
  })

  it('blocks navigation the URL policy does not allow', () => {
    const body = createWindow()
    expect(body).toContain("mainWindow.webContents.on('will-navigate'")
    expect(body).toContain('if (!decideNavigation({ url, isAllowedUrl })) event.preventDefault()')
  })

  it('blocks webviews', () => {
    expect(createWindow()).toContain("mainWindow.webContents.on('will-attach-webview', event => event.preventDefault())")
  })

  it('answers both permission handlers from the pure decision, for the main window only', () => {
    const body = createWindow()
    expect(body).toContain('setPermissionRequestHandler(')
    expect(body).toContain('setPermissionCheckHandler(')
    expect(body).toContain('webContents === mainWindow.webContents && decidePermission({ permission, details })')
    // Both call sites must be guarded: an unguarded grant would be a one-line regression.
    expect(body.match(/decidePermission\(\{ permission, details \}\)/g)).toHaveLength(2)
  })

  it('installs the Q7 handlers on the main window, not a second one', () => {
    expect(createWindow()).toContain('mainSession = mainWindow.webContents.session')
  })
})
