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

  it('gates document navigations only, never in-page hash changes', () => {
    const body = createWindow()
    // HashRouter changes the fragment, which Electron reports as
    // did-navigate-in-page, not will-navigate. If the gate were also put on the
    // in-page event, the policy would have to allow every route the app opens.
    expect(body).not.toContain('did-navigate-in-page')
  })

  it('blocks webviews', () => {
    expect(createWindow()).toContain("mainWindow.webContents.on('will-attach-webview', event => event.preventDefault())")
  })

  it('answers both permission handlers from the pure decisions, for the main window only', () => {
    const body = createWindow()
    expect(body).toContain('setPermissionRequestHandler(')
    expect(body).toContain('setPermissionCheckHandler(')
    // Requests stay video-only; checks grant every media probe, because
    // Chromium hides all device names unless the microphone check passes.
    expect(body).toContain('webContents === mainWindow.webContents && decidePermission({ permission, details })')
    expect(body).toContain('webContents === mainWindow.webContents && decidePermissionCheck({ permission, details })')
    // One call site each: either handler drifting to the other decision is a regression.
    expect(body.match(/decidePermission\(\{ permission, details \}\)/g)).toHaveLength(1)
    expect(body.match(/decidePermissionCheck\(\{ permission, details \}\)/g)).toHaveLength(1)
  })

  it('installs the Q7 handlers on the main window, not a second one', () => {
    expect(createWindow()).toContain('mainSession = mainWindow.webContents.session')
  })
})
