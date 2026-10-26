import { createRequire } from 'module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { DENY_WINDOW_OPEN, decideNavigation, decidePermission, decidePermissionCheck } = require(
  '../../../electron/security/navGuard.cjs'
) as {
  DENY_WINDOW_OPEN: { action: string }
  decideNavigation: (options?: unknown) => boolean
  decidePermission: (options?: unknown) => boolean
  decidePermissionCheck: (options?: unknown) => boolean
}
const { createUrlPolicy } = require('../../../electron/security/senderGuard.cjs') as {
  createUrlPolicy: (options: { indexFileUrl: string; devServerOrigin: string | null }) => (url: unknown) => boolean
}

const INDEX_URL = 'file:///D:/apps/adzu/dist/index.html'
const policy = (devServerOrigin: string | null = null) => createUrlPolicy({ indexFileUrl: INDEX_URL, devServerOrigin })

describe('DENY_WINDOW_OPEN', () => {
  it('denies and cannot be mutated', () => {
    expect(DENY_WINDOW_OPEN).toEqual({ action: 'deny' })
    expect(Object.isFrozen(DENY_WINDOW_OPEN)).toBe(true)
  })
})

describe('decideNavigation', () => {
  it('allows only what the injected policy allows', () => {
    const isAllowedUrl = vi.fn((url: string) => url === 'file:///D:/students')
    expect(decideNavigation({ url: 'file:///D:/students', isAllowedUrl })).toBe(true)
    expect(decideNavigation({ url: 'https://example.com', isAllowedUrl })).toBe(false)
    expect(isAllowedUrl).toHaveBeenCalledWith('file:///D:/students')
  })

  it('accepts the app page and rejects everything else under the real Q6 policy', () => {
    const isAllowedUrl = policy()

    expect(decideNavigation({ url: INDEX_URL, isAllowedUrl })).toBe(true)
    expect(decideNavigation({ url: 'file:///D:/students', isAllowedUrl })).toBe(true)
    expect(decideNavigation({ url: 'https://example.com', isAllowedUrl })).toBe(false)
    expect(decideNavigation({ url: 'http://localhost:5173/', isAllowedUrl })).toBe(false)
    expect(decideNavigation({ url: 'file:///C:/Windows/System32/drivers/etc/hosts', isAllowedUrl })).toBe(false)
  })

  it('follows the same policy in dev, where the Vite origin is allowed', () => {
    const isAllowedUrl = policy('http://localhost:5173')
    expect(decideNavigation({ url: 'http://localhost:5173/students', isAllowedUrl })).toBe(true)
    expect(decideNavigation({ url: 'https://example.com', isAllowedUrl })).toBe(false)
  })

  it('fails closed on bad input or a throwing policy', () => {
    const isAllowedUrl = policy()
    expect(decideNavigation()).toBe(false)
    expect(decideNavigation({})).toBe(false)
    expect(decideNavigation({ url: '', isAllowedUrl })).toBe(false)
    expect(decideNavigation({ url: 42, isAllowedUrl })).toBe(false)
    expect(decideNavigation({ url: 'file:///D:/students' })).toBe(false)
    expect(decideNavigation({ url: 'file:///D:/students', isAllowedUrl: 'yes' })).toBe(false)
    expect(
      decideNavigation({
        url: 'file:///D:/students',
        isAllowedUrl: () => {
          throw new Error('boom')
        }
      })
    ).toBe(false)
  })

  it('requires the policy to answer with a boolean true', () => {
    expect(decideNavigation({ url: 'file:///D:/students', isAllowedUrl: () => 1 })).toBe(false)
    expect(decideNavigation({ url: 'file:///D:/students', isAllowedUrl: () => 'true' })).toBe(false)
  })
})

describe('decidePermission', () => {
  it('grants the camera and only the camera', () => {
    expect(decidePermission({ permission: 'media', details: { mediaTypes: ['video'] } })).toBe(true)
    expect(decidePermission({ permission: 'media', details: { mediaType: 'video' } })).toBe(true)
  })

  it('denies audio and mixed requests', () => {
    expect(decidePermission({ permission: 'media', details: { mediaTypes: ['audio'] } })).toBe(false)
    expect(decidePermission({ permission: 'media', details: { mediaTypes: ['video', 'audio'] } })).toBe(false)
    expect(decidePermission({ permission: 'media', details: { mediaType: 'audio' } })).toBe(false)
  })

  it('denies media requests that name no source', () => {
    expect(decidePermission({ permission: 'media' })).toBe(false)
    expect(decidePermission({ permission: 'media', details: {} })).toBe(false)
    expect(decidePermission({ permission: 'media', details: { mediaTypes: [] } })).toBe(false)
    expect(decidePermission({ permission: 'media', details: null })).toBe(false)
    // Chromium's label/enumeration probe: not a stream, so not granted.
    expect(decidePermission({ permission: 'media', details: { mediaType: 'unknown' } })).toBe(false)
  })

  it('denies every other permission Electron can ask for', () => {
    const others = [
      'notifications',
      'clipboard-read',
      'clipboard-sanitized-write',
      'geolocation',
      'display-capture',
      'midi',
      'midiSysex',
      'openExternal',
      'pointerLock',
      'fullscreen',
      'serial',
      'usb',
      'hid',
      'unknown'
    ]
    for (const permission of others) {
      expect(`${permission}: ${decidePermission({ permission, details: { mediaTypes: ['video'] } })}`).toBe(
        `${permission}: false`
      )
    }
  })

  it('fails closed on malformed input', () => {
    expect(decidePermission()).toBe(false)
    expect(decidePermission({})).toBe(false)
    expect(decidePermission({ permission: 'Media', details: { mediaTypes: ['video'] } })).toBe(false)
    expect(decidePermission({ permission: { name: 'media' }, details: { mediaTypes: ['video'] } })).toBe(false)
    expect(decidePermission({ permission: 'media', details: { mediaTypes: 'video' } })).toBe(false)
  })
})

describe('decidePermissionCheck', () => {
  it('grants every media check, whatever the details say', () => {
    expect(decidePermissionCheck({ permission: 'media', details: { mediaType: 'video' } })).toBe(true)
    expect(decidePermissionCheck({ permission: 'media', details: { mediaTypes: ['video'] } })).toBe(true)
    // Chromium hides all device names unless the microphone check passes, so an
    // audio check is granted even though no audio stream can be opened.
    expect(decidePermissionCheck({ permission: 'media', details: { mediaType: 'audio' } })).toBe(true)
    expect(decidePermissionCheck({ permission: 'media', details: { mediaTypes: ['audio'] } })).toBe(true)
    expect(decidePermissionCheck({ permission: 'media', details: { mediaTypes: ['video', 'audio'] } })).toBe(true)
    expect(decidePermissionCheck({ permission: 'media', details: { mediaType: 'unknown' } })).toBe(true)
    // Measured shape of the enumerateDevices label/id check: no mediaType key.
    expect(
      decidePermissionCheck({
        permission: 'media',
        details: {
          embeddingOrigin: 'http://localhost:5173',
          isMainFrame: true,
          requestingUrl: 'http://localhost:5173/'
        }
      })
    ).toBe(true)
    expect(decidePermissionCheck({ permission: 'media', details: {} })).toBe(true)
    expect(decidePermissionCheck({ permission: 'media', details: null })).toBe(true)
  })

  it('does not weaken the request handler, which stays video-only', () => {
    expect(decidePermission({ permission: 'media', details: { mediaTypes: ['audio'] } })).toBe(false)
    expect(decidePermission({ permission: 'media', details: { mediaTypes: ['video', 'audio'] } })).toBe(false)
    expect(decidePermission({ permission: 'media', details: { mediaType: 'audio' } })).toBe(false)
    // Neither shape of the label check is a stream request either.
    expect(decidePermission({ permission: 'media', details: { mediaType: 'unknown' } })).toBe(false)
    expect(decidePermission({ permission: 'media', details: { requestingUrl: 'http://localhost:5173/' } })).toBe(false)
  })

  it('still denies every non-media permission, whatever the details say', () => {
    const others = [
      'notifications',
      'clipboard-read',
      'clipboard-sanitized-write',
      'geolocation',
      'display-capture',
      'midi',
      'midiSysex',
      'openExternal',
      'pointerLock',
      'fullscreen',
      'serial',
      'usb',
      'hid',
      'unknown'
    ]
    for (const permission of others) {
      expect(`${permission}: ${decidePermissionCheck({ permission, details: { mediaType: 'unknown' } })}`).toBe(
        `${permission}: false`
      )
      expect(`${permission}: ${decidePermissionCheck({ permission, details: { mediaType: 'audio' } })}`).toBe(
        `${permission}: false`
      )
    }
  })

  it('fails closed on a permission it was not given', () => {
    expect(decidePermissionCheck()).toBe(false)
    expect(decidePermissionCheck({})).toBe(false)
    expect(decidePermissionCheck({ permission: 'Media' })).toBe(false)
    expect(decidePermissionCheck({ permission: 'media ' })).toBe(false)
    expect(decidePermissionCheck({ permission: { name: 'media' } })).toBe(false)
  })
})
