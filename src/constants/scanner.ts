export const SCANNER_CONFIG = {
  LIVE_DETECT_INTERVAL_MS: 350,
  LIVE_ANALYSIS_MAX_SIDE: 640,
  CAPTURE_ANALYSIS_MAX_SIDE: 1600,
  /** Region suggested for manual adjustment when no page edge is trustworthy. */
  FALLBACK_INSET_RATIO: 0.1
} as const

/**
 * Tuning for the document detector (src/utils/jscanifyScanner.ts).
 *
 * Every value was measured against synthetic overhead scenes with known page
 * corners (light and dark wood grain, near-white desk, grey, matte black,
 * strong tilt, tight crop, overlapping objects, cast shadow) using the same
 * OpenCV build the app ships. Changing one changes detection on real captures.
 */
export const DETECTOR_TUNE = {
  /** Blur kernel = shortest analysis side / this, floored at `blurMinKernel`. */
  blurDivisor: 160,
  blurMinKernel: 5,
  /** Canny edge-closing kernel = longest analysis side / this. */
  closeDivisor: 110,
  cannyLow: 40,
  cannyHigh: 130,
  /** Adaptive-threshold neighbourhood = shortest side / this, plus this offset. */
  adaptiveBlockDivisor: 10,
  adaptiveC: 8,
  /** A quad must cover this share of the frame — smaller is deferred to manual. */
  minAreaRatio: 0.15,
  maxAreaRatio: 0.92,
  /** Polygon-approximation tolerances tried in order until 4 corners fall out. */
  approxEpsList: [0.02, 0.03, 0.045, 0.06, 0.08],
  /** Contour area / quad area: a page fills its own outline, a merged blob does not. */
  minFill: 0.8,
  minRectFill: 0.86,
  /** Bounding-rectangle quads are a last resort, so they score lower. */
  rectPenalty: 0.7,
  minAngle: 55,
  maxAngle: 125,
  minSideRatio: 0.08,
  /** Rejected outside this aspect band; A4/A3/letter//legal live inside it. */
  aspectHard: [1.0, 2.7],
  aspectGood: [1.15, 1.75],
  /** Interior must be this much lighter than the surround (0-255 scale). */
  minGain: 6,
  /** ...and this share of it, so pages with photos or stamps still qualify. */
  minBright: 0.5,
  gainFull: 40,
  brightFloor: 0.45,
  brightFull: 0.85,
  /** Area stops adding score above this share of the frame. */
  areaFull: 0.4,
  /** Corners within this many px of the frame edge count as flush. */
  edgeTol: 2,
  /** Luminance sampling bands, in analysis px: inner guard ring / outer surround. */
  marginInner: 6,
  marginOuter: 30,
  /** At or above this score the detection may be applied automatically. */
  minConfident: 0.55,
  /** Second (slower) threshold passes only when the edge pass scores below this. */
  fastPathScore: 0.55
}

/**
 * Quality presets offered by the capture screen, highest first. Each is kept
 * only when the active camera reports a capability range covering it.
 */
export const CAMERA_RESOLUTION_PRESETS = [
  { name: '4K UHD', width: 3840, height: 2160 },
  { name: 'QHD', width: 2560, height: 1440 },
  { name: 'Full HD', width: 1920, height: 1080 },
  { name: 'HD', width: 1280, height: 720 },
  { name: 'SD', width: 640, height: 480 }
] as const

/** Shown when a driver refuses to report capabilities (4K UHD, Full HD, HD). */
export const CAMERA_QUALITY_FALLBACK = [
  CAMERA_RESOLUTION_PRESETS[0],
  CAMERA_RESOLUTION_PRESETS[2],
  CAMERA_RESOLUTION_PRESETS[3]
] as const
