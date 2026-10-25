import { describe, expect, it } from 'vitest'
import { describeCameraError } from '@/features/import-scanner/lib/cameraErrors'

const DEFAULT_MESSAGE = 'Failed to access the camera. Please try again.'

const errorWithName = (name: string) => {
  const error = new Error('boom')
  error.name = name
  return error
}

describe('describeCameraError', () => {
  it('explains a denied permission', () => {
    expect(describeCameraError(errorWithName('NotAllowedError'))).toBe(
      'Camera permission was denied. Allow camera access and try again.'
    )
    expect(describeCameraError(errorWithName('PermissionDeniedError'))).toBe(
      'Camera permission was denied. Allow camera access and try again.'
    )
  })

  it('explains a missing device', () => {
    expect(describeCameraError(errorWithName('NotFoundError'))).toBe(
      'No camera was detected. Connect a webcam or document camera and try again.'
    )
    expect(describeCameraError(errorWithName('DevicesNotFoundError'))).toBe(
      'No camera was detected. Connect a webcam or document camera and try again.'
    )
  })

  it('explains a busy device', () => {
    expect(describeCameraError(errorWithName('NotReadableError'))).toBe(
      'The selected camera may be in use by another application. Close the other application and try again.'
    )
    expect(describeCameraError(errorWithName('TrackStartError'))).toBe(
      'The selected camera may be in use by another application. Close the other application and try again.'
    )
  })

  it('explains unsatisfiable constraints', () => {
    expect(describeCameraError(errorWithName('OverconstrainedError'))).toBe(
      'The selected camera could not satisfy the requested settings. Choose another camera or a lower quality option.'
    )
  })

  it('falls back to the generic message for an unnamed or unrelated Error', () => {
    expect(describeCameraError(new Error('camera exploded'))).toBe(DEFAULT_MESSAGE)
    expect(describeCameraError(errorWithName('SomethingWeirdError'))).toBe(DEFAULT_MESSAGE)
  })

  it('falls back for non-Error values, including objects that carry a name', () => {
    expect(describeCameraError('NotAllowedError')).toBe(DEFAULT_MESSAGE)
    expect(describeCameraError(null)).toBe(DEFAULT_MESSAGE)
    expect(describeCameraError(undefined)).toBe(DEFAULT_MESSAGE)
    expect(describeCameraError({ name: 'NotFoundError' })).toBe(DEFAULT_MESSAGE)
  })

  it('maps an Error subclass the same way (getUserMedia throws DOMException)', () => {
    class DomErrorLike extends Error {
      constructor() {
        super('denied')
        this.name = 'NotAllowedError'
      }
    }
    expect(describeCameraError(new DomErrorLike())).toBe(
      'Camera permission was denied. Allow camera access and try again.'
    )
  })

  it.runIf(typeof DOMException !== 'undefined')(
    'labels a real DOMException — getUserMedia rejects with one, not with Error',
    () => {
      const denied = new DOMException('Permission denied', 'NotAllowedError')
      expect(denied.name).toBe('NotAllowedError')
      expect(describeCameraError(denied)).toBe('Camera permission was denied. Allow camera access and try again.')

      const busy = new DOMException('Starting failed', 'NotReadableError')
      expect(describeCameraError(busy)).toBe(
        'The selected camera may be in use by another application. Close the other application and try again.'
      )
    }
  )

  it('never returns an empty string', () => {
    for (const value of [new Error(''), '', 0, false, {}, []]) {
      expect(describeCameraError(value)).not.toBe('')
    }
  })
})
