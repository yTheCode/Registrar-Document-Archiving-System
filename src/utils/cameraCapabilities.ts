import { CAMERA_QUALITY_FALLBACK, CAMERA_RESOLUTION_PRESETS } from '@/constants/scanner'

/**
 * A capture-quality option backed by a resolution the selected video device
 * reports support for.
 */
export interface CameraQuality {
  width: number
  height: number
  name: string
  label: string
  nativeMax: boolean
}

export const cameraQualityKey = (q: { width: number; height: number }) => `${q.width}x${q.height}`

function buildQuality(name: string, width: number, height: number, nativeMax: boolean): CameraQuality {
  const size = `${width} × ${height}`
  return { width, height, name, nativeMax, label: `${name ? `${name} ` : ''}${size}${nativeMax ? ' [Native Max]' : ''}` }
}

/** Used whenever the driver hides its capability ranges — still applied as `ideal` targets. */
function fallbackQualities(): CameraQuality[] {
  return CAMERA_QUALITY_FALLBACK.map(p => buildQuality(p.name, p.width, p.height, false))
}

function probeQualities(track: MediaStreamTrack): CameraQuality[] {
  const supported = navigator.mediaDevices.getSupportedConstraints()
  if (!supported.width || !supported.height) return fallbackQualities()

  const settings = track.getSettings()
  const currentWidth = Math.round(settings.width ?? 0)
  const currentHeight = Math.round(settings.height ?? 0)
  const caps = track.getCapabilities()

  // Some drivers report per-axis maxima of the running mode only, so never let
  // the ceiling fall below the frame the camera is already delivering.
  const maxWidth = Math.max(Math.round(caps.width?.max ?? 0), currentWidth)
  const maxHeight = Math.max(Math.round(caps.height?.max ?? 0), currentHeight)
  const minWidth = Math.round(caps.width?.min ?? 0)
  const minHeight = Math.round(caps.height?.min ?? 0)

  if (maxWidth <= 0 || maxHeight <= 0) return fallbackQualities()

  const presets = CAMERA_RESOLUTION_PRESETS
    .filter(p => p.width <= maxWidth && p.height <= maxHeight && p.width >= minWidth && p.height >= minHeight)
    .map(p => buildQuality(p.name, p.width, p.height, false))

  if (presets.length === 0 && currentWidth > 0 && currentHeight > 0) {
    return [buildQuality('', currentWidth, currentHeight, true)]
  }

  // The capability ceiling becomes its own option only when it is higher than
  // every preset and shaped like the modes the camera really runs — some UVC
  // drivers advertise a square "max" that no mode satisfies.
  const hasCurrent = currentWidth > 0 && currentHeight > 0
  const aspectGap = hasCurrent
    ? Math.abs(maxWidth / maxHeight - currentWidth / currentHeight) / (currentWidth / currentHeight)
    : 0
  const areaGap = hasCurrent ? (maxWidth * maxHeight) / (currentWidth * currentHeight) : 1
  const plausibleNative = aspectGap <= 0.3 && areaGap <= 3
  const beatsPresets = presets.length === 0 || maxWidth * maxHeight > presets[0].width * presets[0].height

  const options = plausibleNative && beatsPresets
    ? [buildQuality('', maxWidth, maxHeight, true), ...presets]
    : presets
  if (options.length > 0 && !options[0].nativeMax) {
    options[0] = buildQuality(options[0].name, options[0].width, options[0].height, true)
  }

  return options
}

/**
 * Build the quality list for a live track from its hardware capabilities.
 * Must be called after `getUserMedia()` resolved — capabilities only exist on a
 * started track. Any driver that refuses to report them gets the standard
 * presets so the preview and the dropdown keep working.
 */
export function listCameraQualities(track: MediaStreamTrack): CameraQuality[] {
  if (!track || typeof track.getCapabilities !== 'function' || typeof track.getSettings !== 'function') {
    return fallbackQualities()
  }
  try {
    return probeQualities(track)
  } catch (error) {
    console.warn('Could not read track capabilities, falling back to standard presets:', error)
    return fallbackQualities()
  }
}

/**
 * Move the track to a quality option with soft constraints only. `exact` sizes
 * make several webcam and scanner drivers (CZUR Shine among them) refuse the
 * stream outright, so the closest supported mode is what we ask for.
 */
export async function applyCameraQuality(track: MediaStreamTrack, quality: CameraQuality): Promise<void> {
  if (quality.width <= 0 || quality.height <= 0) return
  if (typeof track.applyConstraints !== 'function') return
  await track.applyConstraints({ width: { ideal: quality.width }, height: { ideal: quality.height } })
}

/** The resolution the device is currently delivering, or zeros when unknown. */
export function readTrackResolution(track: MediaStreamTrack): { width: number; height: number } {
  try {
    const { width, height } = track.getSettings()
    return { width: Math.round(width ?? 0), height: Math.round(height ?? 0) }
  } catch (error) {
    console.warn('Could not read track settings:', error)
    return { width: 0, height: 0 }
  }
}

export function formatResolution(width: number, height: number): string {
  if (!width || !height) return ''
  return `${width} × ${height}`
}
