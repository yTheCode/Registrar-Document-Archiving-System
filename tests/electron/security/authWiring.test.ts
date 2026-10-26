import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

// Static wiring tests. authz.cjs, auth.ipc.cjs and main.cjs cannot be required
// outside Electron (their require chain reaches paths.cjs -> app.getPath at
// module scope), so the wiring is pinned by reading the source. The decision
// logic itself is covered by session.test.ts and adminDecision.test.ts.
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const authz = read('../../../electron/services/authz.cjs')
const authIpc = read('../../../electron/ipc/auth.ipc.cjs')
const main = read('../../../electron/main.cjs')
const preload = read('../../../electron/preload.js')
const types = read('../../../src/types/electron.d.ts')
const app = read('../../../src/App.tsx')

describe('services/authz.cjs (Q5)', () => {
  it('decides through the session and the pure decision module', () => {
    expect(authz).toContain("require('../security/session.cjs')")
    expect(authz).toContain("require('../security/adminDecision.cjs')")
    expect(authz).toContain('session.isCurrentUser(userId)')
    expect(authz).toContain('decideAdmin({')
  })

  it('re-reads the account row on every call, including its status', () => {
    expect(authz).toContain('SELECT role, status FROM users WHERE id = ?')
    expect(authz).toContain('getDb().prepare(')
  })

  it('never touches the database at module load time', () => {
    const beforeFunction = authz.slice(0, authz.indexOf('async function isAdmin'))
    expect(beforeFunction).not.toMatch(/getDb\(\)/)
  })
})

describe('ipc/auth.ipc.cjs (Q5)', () => {
  it('sets the session exactly once, and only after the password is accepted', () => {
    expect(authIpc.match(/session\.set\(/g)).toHaveLength(1)
    expect(authIpc.indexOf('session.set(user)')).toBeGreaterThan(authIpc.indexOf('if (!isPasswordValid)'))
  })

  it('registers auth:logout and clears the session there', () => {
    const logoutAt = authIpc.indexOf("ipcMain.handle('auth:logout'")
    expect(logoutAt).toBeGreaterThan(-1)
    const logoutBody = authIpc.slice(logoutAt)
    expect(logoutBody).toContain('session.clear()')
    expect(logoutBody).toContain('success: true')
  })

  it('still registers exactly two channels', () => {
    expect(authIpc.match(/ipcMain\.handle\(/g)).toHaveLength(2)
  })
})

describe('main.cjs (Q5)', () => {
  it('clears the session when the main window is closed', () => {
    expect(main).toContain("require('./security/session.cjs')")
    const closedAt = main.indexOf("mainWindow.on('closed'")
    expect(closedAt).toBeGreaterThan(-1)
    expect(main.slice(closedAt)).toContain('session.clear()')
  })
})

describe('renderer logout wiring (Q5)', () => {
  it('exposes logout() through the preload bridge', () => {
    expect(preload).toContain("logout: () => ipcRenderer.invoke('auth:logout')")
  })

  it('types logout() on the bridge', () => {
    expect(types).toContain('logout(): Promise<IpcResult>')
  })

  it('calls logout() before clearing sessionStorage', () => {
    const logoutAt = app.indexOf('window.electronAPI.logout()')
    const removeAt = app.indexOf("sessionStorage.removeItem('user')")
    expect(logoutAt).toBeGreaterThan(-1)
    expect(removeAt).toBeGreaterThan(-1)
    expect(logoutAt).toBeLessThan(removeAt)
  })
})
