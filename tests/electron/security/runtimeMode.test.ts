import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

// The module is CommonJS and requires nothing, so it loads cleanly in Node.
const require = createRequire(import.meta.url)
const { DEV_SERVER_URL, resolveRuntimeMode } = require('../../../electron/security/runtimeMode.cjs') as {
  DEV_SERVER_URL: string
  resolveRuntimeMode: (options?: unknown) => {
    isDev: boolean
    devServerUrl: string | null
    openDevTools: boolean
  }
}

describe('resolveRuntimeMode', () => {
  it('is production when Electron reports the app as packaged', () => {
    expect(resolveRuntimeMode({ isPackaged: true })).toEqual({
      isDev: false,
      devServerUrl: null,
      openDevTools: false
    })
  })

  it('is dev only for an unpackaged build', () => {
    expect(resolveRuntimeMode({ isPackaged: false })).toEqual({
      isDev: true,
      devServerUrl: DEV_SERVER_URL,
      openDevTools: true
    })
  })

  it('targets the Vite dev server in dev mode', () => {
    expect(DEV_SERVER_URL).toBe('http://localhost:5173')
    expect(resolveRuntimeMode({ isPackaged: false }).devServerUrl).toBe(DEV_SERVER_URL)
  })

  it('never hands out a dev server URL in a packaged build', () => {
    // The acceptance case: an env var must not be able to flip an installed copy.
    expect(resolveRuntimeMode({ isPackaged: true, nodeEnv: 'development' }).devServerUrl).toBeNull()
    expect(resolveRuntimeMode({ isPackaged: true, NODE_ENV: 'development' }).devServerUrl).toBeNull()
  })

  it('ignores any extra environment-style keys', () => {
    expect(resolveRuntimeMode({ isPackaged: true, nodeEnv: 'development', dev: true })).toEqual(
      resolveRuntimeMode({ isPackaged: true })
    )
    expect(resolveRuntimeMode({ isPackaged: false, nodeEnv: 'production' })).toEqual(
      resolveRuntimeMode({ isPackaged: false })
    )
  })

  it('fails closed when the packaged flag is missing or not a boolean', () => {
    const production = { isDev: false, devServerUrl: null, openDevTools: false }

    expect(resolveRuntimeMode()).toEqual(production)
    expect(resolveRuntimeMode({})).toEqual(production)
    expect(resolveRuntimeMode({ isPackaged: undefined })).toEqual(production)
    expect(resolveRuntimeMode({ isPackaged: null })).toEqual(production)
    // A stringified flag is a likely caller mistake; it must not enable dev mode.
    expect(resolveRuntimeMode({ isPackaged: 'false' })).toEqual(production)
    expect(resolveRuntimeMode({ isPackaged: 0 })).toEqual(production)
  })

  it('keeps DevTools tied to dev mode, not to a separate switch', () => {
    expect(resolveRuntimeMode({ isPackaged: false }).openDevTools).toBe(true)
    expect(resolveRuntimeMode({ isPackaged: true }).openDevTools).toBe(false)
  })
})
