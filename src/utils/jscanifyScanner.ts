/**
 * Thin adapter around the locally bundled jscanify + OpenCV.js assets.
 *
 * Both files are copied from the pinned `jscanify` devDependency into
 * public/scanner/ (see scripts/prepare-scanner-assets.mjs) and loaded as plain
 * classic scripts, so nothing is fetched from a CDN and OpenCV's WASM (embedded
 * as a data URI inside opencv.js) works from file:// in a packaged build.
 *
 * jscanify still performs the perspective warp; the contour search that feeds it
 * lives here because the bundled one only works on dark matte backgrounds.
 * This module handles script loading once, the detection itself (see
 * detectPaperQuad) and coordinate mapping. Shared quad geometry lives in
 * src/utils/imageProcessing.ts.
 */

import type { CvMat, CvMatVector, CvModule, CvPoint, JscanifyInstance } from '../types/jscanify'
import type { DocCornerPoints } from './imageProcessing'
import {
  angleBetween,
  luminanceStats,
  orderCornerPoints,
  quadArea,
  quadAspect,
  quadCorners,
  quadSize,
} from './imageProcessing'
import { DETECTOR_TUNE } from '@/constants/scanner'
import { IMAGE_QUALITY } from '@/constants/image'

// Relative to document.baseURI so it resolves under both http://localhost (dev)
// and file:///.../dist/index.html (packaged Electron)
const OPENCV_ASSET = 'scanner/opencv.js'
const JSCANIFY_ASSET = 'scanner/jscanify.js'

export interface PaperQuad {
  corners: DocCornerPoints
  /** Aspect-preserving output size suggested by the detected edges */
  width: number
  height: number
  /** 0-1 plausibility of this region, from contrast, shape and size */
  confidence: number
  /** Safe to apply automatically; below this the user must adjust first */
  confident: boolean
  /** Which stage located it — kept for the editor's wording and debugging */
  source: 'edges' | 'adaptive' | 'otsu'
}

let loaderPromise: Promise<void> | null = null
let scanner: JscanifyInstance | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-scanner-asset="${src}"]`)
    if (existing) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = new URL(src, document.baseURI).href
    script.async = true
    script.dataset.scannerAsset = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load scanner asset: ${src}`))
    document.head.appendChild(script)
  })
}

/**
 * Loads OpenCV.js then jscanify exactly once and waits for the WASM runtime.
 * Repeat calls share the same promise; a failed attempt can be retried.
 */
export function initScanner(): Promise<void> {
  if (!loaderPromise) {
    loaderPromise = (async () => {
      await loadScript(OPENCV_ASSET)
      const cv = window.cv
      if (!cv) throw new Error('OpenCV.js did not register window.cv')
      if (!cv.calledRun) {
        await new Promise<void>(resolve => {
          cv.onRuntimeInitialized = () => resolve()
        })
      }
      await loadScript(JSCANIFY_ASSET)
      const Jscanify = window.jscanify
      if (!Jscanify) throw new Error('jscanify did not register window.jscanify')
      scanner = new Jscanify()
    })().catch(error => {
      loaderPromise = null
      throw error
    })
  }
  return loaderPromise
}

export function isScannerReady(): boolean {
  return scanner !== null && Boolean(window.cv)
}

function sourceSize(source: HTMLImageElement | HTMLCanvasElement): { w: number; h: number } {
  if (source instanceof HTMLCanvasElement) return { w: source.width, h: source.height }
  return { w: source.naturalWidth || source.width, h: source.naturalHeight || source.height }
}

function oddKernel(value: number, min: number): number {
  const n = Math.max(min, Math.round(value))
  return n % 2 === 0 ? n + 1 : n
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function cornerPointsOf(mat: CvMat): DocCornerPoints | null {
  const data = mat.data32S
  if (!data || data.length < 8) return null
  return orderCornerPoints([
    { x: data[0], y: data[1] },
    { x: data[2], y: data[3] },
    { x: data[4], y: data[5] },
    { x: data[6], y: data[7] },
  ])
}

interface QuadCandidate {
  corners: DocCornerPoints
  source: PaperQuad['source']
  via: 'poly' | 'rect'
  score: number
}

/**
 * Reduce a contour to four corners: the tightest polygon that still collapses to
 * a convex quad, otherwise its bounding rectangle (tried last and down-weighted,
 * because a rectangle happily boxes a merged blob).
 */
function quadFromContour(
  cv: CvModule,
  contour: CvMat,
  approx: CvMat
): { corners: DocCornerPoints; via: QuadCandidate['via']; weight: number; fill: number } | null {
  const perimeter = cv.arcLength(contour, true)
  if (perimeter <= 0) return null
  const area = cv.contourArea(contour)

  for (const eps of DETECTOR_TUNE.approxEpsList) {
    cv.approxPolyDP(contour, approx, eps * perimeter, true)
    if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue
    const corners = cornerPointsOf(approx)
    if (!corners) continue
    const fill = area / quadArea(corners)
    if (fill < DETECTOR_TUNE.minFill) return null
    return { corners, via: 'poly', weight: 1, fill }
  }

  const rect = cv.minAreaRect(contour)
  if (!rect.points || rect.points.length !== 4) return null
  const corners = orderCornerPoints(rect.points.map(p => ({ x: p.x, y: p.y })))
  const fill = area / quadArea(corners)
  if (fill < DETECTOR_TUNE.minRectFill) return null
  return { corners, via: 'rect', weight: DETECTOR_TUNE.rectPenalty, fill }
}

/**
 * Gate a candidate quad and score it. Area and shape must look like a document,
 * and the interior has to read as paper — lighter and more uniform than the
 * surface around it. Contrast leads the score; size only breaks ties, otherwise
 * a big shadow patch outranks the page next to it.
 */
function scoreCandidate(
  corners: DocCornerPoints,
  width: number,
  height: number,
  gray: Uint8Array,
  weight: number,
  fill: number
): { score: number } | null {
  const points = quadCorners(corners)
  const ratio = quadArea(corners) / (width * height)
  if (!(ratio >= DETECTOR_TUNE.minAreaRatio && ratio <= DETECTOR_TUNE.maxAreaRatio)) return null
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null

  let angleDeviation = 0
  for (let i = 0; i < 4; i++) {
    const angle = angleBetween(points[(i + 3) % 4], points[i], points[(i + 1) % 4])
    if (angle < DETECTOR_TUNE.minAngle || angle > DETECTOR_TUNE.maxAngle) return null
    angleDeviation += Math.abs(angle - 90)
  }
  angleDeviation /= 4

  const sides = [0, 1, 2, 3].map(i =>
    Math.hypot(points[(i + 1) % 4].x - points[i].x, points[(i + 1) % 4].y - points[i].y)
  )
  if (sides.some(s => s < Math.max(width, height) * DETECTOR_TUNE.minSideRatio)) return null

  const aspect = quadAspect(corners)
  const [aspectMin, aspectMax] = DETECTOR_TUNE.aspectHard
  if (aspect < aspectMin || aspect > aspectMax) return null
  const [goodMin, goodMax] = DETECTOR_TUNE.aspectGood
  const aspectPenalty = aspect >= goodMin && aspect <= goodMax
    ? 0
    : clamp01(aspect > goodMax ? aspect - goodMax : goodMin - aspect)

  const { gain, bright } = luminanceStats(gray, width, height, corners, {
    marginInner: DETECTOR_TUNE.marginInner,
    marginOuter: DETECTOR_TUNE.marginOuter,
    minGain: DETECTOR_TUNE.minGain,
  })
  if (gain < DETECTOR_TUNE.minGain || bright < DETECTOR_TUNE.minBright) return null

  const flush = points.filter(p => p.x <= DETECTOR_TUNE.edgeTol || p.y <= DETECTOR_TUNE.edgeTol ||
    p.x >= width - 1 - DETECTOR_TUNE.edgeTol || p.y >= height - 1 - DETECTOR_TUNE.edgeTol).length

  const shape = (1 - clamp01(angleDeviation / 35) * 0.5) * (1 - aspectPenalty * 0.5)
  const contrast = clamp01(gain / DETECTOR_TUNE.gainFull) *
    clamp01((bright - DETECTOR_TUNE.brightFloor) / (DETECTOR_TUNE.brightFull - DETECTOR_TUNE.brightFloor))
  const size = clamp01(ratio / DETECTOR_TUNE.areaFull)
  const fillPenalty = clamp01((1 - fill) / (1 - DETECTOR_TUNE.minFill)) * 0.12
  const edgePenalty = flush >= 3 ? 0.12 : 0

  return {
    score: (contrast * 0.5 + shape * 0.35 + size * 0.1 - fillPenalty - edgePenalty) * weight,
  }
}

/** Best plausible quad inside one binary mask. */
function bestInMask(
  cv: CvModule,
  mask: CvMat,
  width: number,
  height: number,
  grayData: Uint8Array,
  source: PaperQuad['source'],
  current: QuadCandidate | null
): QuadCandidate | null {
  const contours: CvMatVector = new cv.MatVector()
  const hierarchy = new cv.Mat()
  cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
  const approx = new cv.Mat()
  let best = current
  const frameArea = width * height

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i)
    const area = cv.contourArea(contour)
    if (area >= DETECTOR_TUNE.minAreaRatio * frameArea &&
      area <= DETECTOR_TUNE.maxAreaRatio * frameArea && contour.rows >= 4) {
      const quad = quadFromContour(cv, contour, approx)
      if (quad) {
        const scored = scoreCandidate(quad.corners, width, height, grayData, quad.weight, quad.fill)
        if (scored && (!best || scored.score > best.score)) {
          best = { corners: quad.corners, source, via: quad.via, score: scored.score }
        }
      }
    }
    contour.delete()
  }

  contours.delete()
  hierarchy.delete()
  approx.delete()
  return best
}

/**
 * Find the document quad inside `source` and return its four corners in the
 * source's own pixel space, or null when nothing plausible was found.
 *
 * jscanify's own contour search is not used here: Canny straight into a static
 * Otsu threshold keys on wood grain and cast shadow, so it locks onto the wrong
 * blob on anything but a dark matte surface. This search blurs first, closes the
 * edge map so a page outline becomes one region, and validates candidates
 * against shape, size and how much they read as paper.
 *
 * `maxSide` analyses a downscaled copy for speed (live preview) while still
 * reporting full-resolution coordinates.
 */
export function detectPaperQuad(
  source: HTMLImageElement | HTMLCanvasElement,
  options?: { maxSide?: number }
): PaperQuad | null {
  const cv = window.cv
  if (!scanner || !cv) return null

  const { w: srcW, h: srcH } = sourceSize(source)
  if (!srcW || !srcH) return null

  const maxSide = options?.maxSide ?? 0
  const scale = maxSide > 0 ? Math.min(1, maxSide / Math.max(srcW, srcH)) : 1
  const w = Math.max(16, Math.round(srcW * scale))
  const h = Math.max(16, Math.round(srcH * scale))

  const work = document.createElement('canvas')
  work.width = w
  work.height = h
  const ctx = work.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, w, h)

  const mat = cv.imread(work)
  const gray = new cv.Mat()
  const blur = new cv.Mat()
  const mask = new cv.Mat()
  const edges = new cv.Mat()
  try {
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY)
    const kernel = oddKernel(Math.min(w, h) / DETECTOR_TUNE.blurDivisor, DETECTOR_TUNE.blurMinKernel)
    cv.GaussianBlur(gray, blur, new cv.Size(kernel, kernel), 0)
    const grayData = gray.data
    if (!grayData) return null

    // Edges first: it survives texture and uneven lighting, and is the cheap pass.
    cv.Canny(blur, edges, DETECTOR_TUNE.cannyLow, DETECTOR_TUNE.cannyHigh)
    const close = oddKernel(Math.max(w, h) / DETECTOR_TUNE.closeDivisor, 3)
    const structuring = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(close, close))
    cv.morphologyEx(edges, mask, cv.MORPH_CLOSE, structuring)
    structuring.delete()
    let best = bestInMask(cv, mask, w, h, grayData, 'edges', null)

    // Thresholds only when the edge pass came up short — they win on flat,
    // low-texture surfaces where the page is simply the brightest thing around.
    if (!best || best.score < DETECTOR_TUNE.fastPathScore) {
      const block = oddKernel(Math.min(w, h) / DETECTOR_TUNE.adaptiveBlockDivisor, 9)
      cv.adaptiveThreshold(blur, mask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV,
        block, DETECTOR_TUNE.adaptiveC)
      best = bestInMask(cv, mask, w, h, grayData, 'adaptive', best)

      cv.threshold(blur, mask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU)
      best = bestInMask(cv, mask, w, h, grayData, 'otsu', best)
    }

    if (!best) return null

    // Map back to the source's coordinate space
    const k = 1 / scale
    const clampPoint = (p: CvPoint): CvPoint => ({
      x: Math.min(srcW, Math.max(0, p.x * k)),
      y: Math.min(srcH, Math.max(0, p.y * k)),
    })
    const corners: DocCornerPoints = {
      topLeftCorner: clampPoint(best.corners.topLeftCorner),
      topRightCorner: clampPoint(best.corners.topRightCorner),
      bottomRightCorner: clampPoint(best.corners.bottomRightCorner),
      bottomLeftCorner: clampPoint(best.corners.bottomLeftCorner),
    }
    const { width, height } = quadSize(corners)

    return {
      corners,
      width,
      height,
      source: best.source,
      confidence: Number(Math.min(1, Math.max(0, best.score)).toFixed(2)),
      confident: best.score >= DETECTOR_TUNE.minConfident,
    }
  } catch (error) {
    console.error('Document detection failed:', error)
    return null
  } finally {
    mat.delete()
    gray.delete()
    blur.delete()
    mask.delete()
    edges.delete()
  }
}

/**
 * Extracts and perspective-corrects the detected region through jscanify,
 * returning a JPEG data URL, or null when extraction is not possible.
 */
export function extractPaperDataUrl(
  source: HTMLImageElement | HTMLCanvasElement,
  quad: Pick<PaperQuad, 'corners' | 'width' | 'height'>
): string | null {
  if (!scanner) return null
  try {
    const canvas = scanner.extractPaper(source, quad.width, quad.height, quad.corners)
    if (!canvas) return null
    return canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
  } catch (error) {
    console.error('jscanify extraction failed:', error)
    return null
  }
}

/**
 * Warp a corner set the user has moved by hand; the output size follows the
 * corners so the page keeps its own proportions.
 */
export function extractQuadDataUrl(
  source: HTMLImageElement | HTMLCanvasElement,
  corners: DocCornerPoints
): string | null {
  return extractPaperDataUrl(source, { corners, ...quadSize(corners) })
}
