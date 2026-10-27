import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

// Pure module: no electron or paths import, so it loads in Node. Required via
// createRequire so the .cjs stays a plain CJS graph with nothing stubbed.
const require = createRequire(import.meta.url)
const { createSenderGuard, createUrlPolicy } = require('../../../electron/security/senderGuard.cjs') as {
  createSenderGuard: (deps?: {
    getMainWebContents?: () => unknown
    isAllowedUrl?: (url: string) => boolean
  }) => (event: unknown) => boolean
  createUrlPolicy: (options: { indexFileUrl: string; devServerOrigin: string | null }) => (url: unknown) => boolean
}

const INDEX_URL = 'file:///C:/app/dist/index.html'
// The real Q6 policy, so these cases prove the guard and the policy agree.
const realPolicy = () => createUrlPolicy({ indexFileUrl: INDEX_URL, devServerOrigin: null })

function makeWorld({ url = INDEX_URL, allowed = (u: string) => u === INDEX_URL } = {}) {
  const mainFrame = { frameTreeNodeId: 1, url }
  const webContents = { mainFrame, isDestroyed: () => false }
  const calls: string[] = []
  const isAllowedUrl = (u: string) => {
    calls.push(u)
    return allowed(u)
  }
  const validate = createSenderGuard({ getMainWebContents: () => webContents, isAllowedUrl })
  return { validate, webContents, mainFrame, isAllowedUrl, calls }
}

describe('createSenderGuard', () => {
  it('accepts an event from the main window main frame on an allowed URL', () => {
    const { validate, webContents, mainFrame } = makeWorld()
    expect(validate({ sender: webContents, senderFrame: mainFrame })).toBe(true)
  })

  it('rejects a sender that is not the main window web contents', () => {
    const { validate, mainFrame } = makeWorld()
    const otherWindow = { mainFrame, isDestroyed: () => false }
    expect(validate({ sender: otherWindow, senderFrame: mainFrame })).toBe(false)
  })

  it('rejects a child iframe even when its sender is the main window', () => {
    const { validate, webContents, mainFrame } = makeWorld()
    const childFrame = { frameTreeNodeId: 7, url: INDEX_URL }
    expect(validate({ sender: webContents, senderFrame: childFrame })).toBe(false)
    expect(mainFrame.frameTreeNodeId).toBe(1)
  })

  it('rejects a foreign URL that the policy does not allow', () => {
    const foreign = 'https://evil.example/index.html'
    const { validate, webContents, mainFrame } = makeWorld({ url: foreign })
    expect(validate({ sender: webContents, senderFrame: mainFrame })).toBe(false)
  })

  it('passes the frame URL (not the web contents URL) to the policy', () => {
    const { validate, webContents, mainFrame, calls } = makeWorld()
    validate({ sender: webContents, senderFrame: mainFrame })
    expect(calls).toEqual([INDEX_URL])
  })

  it('accepts the main frame on the index page with a HashRouter route', () => {
    const { validate, webContents, mainFrame } = makeWorld({
      url: `${INDEX_URL}#/students`,
      allowed: realPolicy()
    })
    expect(validate({ sender: webContents, senderFrame: mainFrame })).toBe(true)
  })

  it('still rejects any other file, hash route and all', () => {
    const allowed = realPolicy()
    const { validate, webContents, mainFrame } = makeWorld({
      url: 'file:///C:/app/dist/other.html#/students',
      allowed
    })
    expect(validate({ sender: webContents, senderFrame: mainFrame })).toBe(false)
  })

  it('rejects a destroyed or missing event frame', () => {
    const { validate, webContents } = makeWorld()
    expect(validate({ sender: webContents, senderFrame: null })).toBe(false)
    expect(validate({ sender: webContents })).toBe(false)
  })

  it('rejects when there is no main window', () => {
    const mainFrame = { frameTreeNodeId: 1, url: INDEX_URL }
    const validate = createSenderGuard({
      getMainWebContents: () => null,
      isAllowedUrl: () => true
    })
    expect(validate({ sender: { mainFrame }, senderFrame: mainFrame })).toBe(false)
  })

  it('rejects when the main window web contents is destroyed', () => {
    const mainFrame = { frameTreeNodeId: 1, url: INDEX_URL }
    const webContents = { mainFrame, isDestroyed: () => true }
    const validate = createSenderGuard({ getMainWebContents: () => webContents, isAllowedUrl: () => true })
    expect(validate({ sender: webContents, senderFrame: mainFrame })).toBe(false)
  })

  it('rejects when the main window lookup throws', () => {
    const validate = createSenderGuard({
      getMainWebContents: () => {
        throw new Error('window is gone')
      },
      isAllowedUrl: () => true
    })
    expect(validate({ sender: {}, senderFrame: {} })).toBe(false)
  })

  it('rejects when the URL policy throws or is missing', () => {
    const mainFrame = { frameTreeNodeId: 1, url: INDEX_URL }
    const webContents = { mainFrame, isDestroyed: () => false }
    const throwing = createSenderGuard({
      getMainWebContents: () => webContents,
      isAllowedUrl: () => {
        throw new Error('bad url')
      }
    })
    expect(throwing({ sender: webContents, senderFrame: mainFrame })).toBe(false)

    const missing = createSenderGuard({ getMainWebContents: () => webContents })
    expect(missing({ sender: webContents, senderFrame: mainFrame })).toBe(false)
  })

  it('rejects a null event and a missing web contents main frame', () => {
    const { validate } = makeWorld()
    expect(validate(null)).toBe(false)
    expect(validate(undefined)).toBe(false)

    const noMainFrame = createSenderGuard({
      getMainWebContents: () => ({ isDestroyed: () => false }),
      isAllowedUrl: () => true
    })
    expect(noMainFrame({ sender: {}, senderFrame: {} })).toBe(false)
  })

  it('still matches the main frame when Electron hands out a fresh frame wrapper', () => {
    const mainFrame = { frameTreeNodeId: 1, url: INDEX_URL }
    const webContents = { mainFrame, isDestroyed: () => false }
    const validate = createSenderGuard({ getMainWebContents: () => webContents, isAllowedUrl: () => true })
    const sameFrameDifferentObject = { frameTreeNodeId: 1, url: INDEX_URL }
    expect(validate({ sender: webContents, senderFrame: sameFrameDifferentObject })).toBe(true)

    const differentFrame = { frameTreeNodeId: 2, url: INDEX_URL }
    expect(validate({ sender: webContents, senderFrame: differentFrame })).toBe(false)
  })
})
