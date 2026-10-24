/**
 * Image processing helpers for the document-scanning editor.
 *
 * This module owns the neutral geometry shared by the detector and the editor:
 * quadrilateral maths, corner ordering, the suggested fallback region, and the
 * rectangular crop used by the manual cropping tool. Perspective correction is
 * delegated to jscanify and detection to src/utils/jscanifyScanner.ts.
 *
 * Quality settings:
 * - All JPEG exports use IMAGE_QUALITY (0.92), suitable for archival documents,
 *   printing and later OCR processing.
 */

import { IMAGE_QUALITY } from '@/constants/image'

export interface CropBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CornerPoint {
  x: number
  y: number
}

/** Four document corners, named by their position in the frame. */
export interface DocCornerPoints {
  topLeftCorner: CornerPoint
  topRightCorner: CornerPoint
  bottomRightCorner: CornerPoint
  bottomLeftCorner: CornerPoint
}

/** Walk order of a quad: top-left, top-right, bottom-right, bottom-left. */
export function quadCorners(c: DocCornerPoints): CornerPoint[] {
  return [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner]
}

/**
 * Name four unordered points as TL/TR/BR/BL. The corner with the smallest x+y is
 * top-left and the largest is bottom-right; x-y then separates the other two,
 * which stays correct for a rotated or perspective-skewed page.
 */
export function orderCornerPoints(points: CornerPoint[]): DocCornerPoints {
  const keyed = points.map(p => ({ p, sum: p.x + p.y, dif: p.x - p.y }))
  const by = (cmp: (a: (typeof keyed)[0], b: (typeof keyed)[0]) => boolean) =>
    keyed.reduce((acc, cur) => (cmp(cur, acc) ? cur : acc)).p
  return {
    topLeftCorner: by((a, b) => a.sum < b.sum),
    bottomRightCorner: by((a, b) => a.sum > b.sum),
    topRightCorner: by((a, b) => a.dif > b.dif),
    bottomLeftCorner: by((a, b) => a.dif < b.dif),
  }
}

/** Shoelace area of a quad. */
export function quadArea(c: DocCornerPoints): number {
  const p = quadCorners(c)
  let area = 0
  for (let i = 0; i < 4; i++) {
    const q = p[(i + 1) % 4]
    area += p[i].x * q.y - q.x * p[i].y
  }
  return Math.abs(area / 2)
}

/** Interior angle at `cur`, in degrees. */
export function angleBetween(prev: CornerPoint, cur: CornerPoint, next: CornerPoint): number {
  const v1x = prev.x - cur.x
  const v1y = prev.y - cur.y
  const v2x = next.x - cur.x
  const v2y = next.y - cur.y
  const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1)
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI
}

/** Long side / short side; ~1.41 for A-series paper, ~1.29 for US letter. */
export function quadAspect(c: DocCornerPoints): number {
  const p = quadCorners(c)
  const dist = (a: CornerPoint, b: CornerPoint) => Math.hypot(b.x - a.x, b.y - a.y)
  const horiz = (dist(p[0], p[1]) + dist(p[3], p[2])) / 2
  const vert = (dist(p[0], p[3]) + dist(p[1], p[2])) / 2
  const lo = Math.min(horiz, vert)
  return lo > 0 ? Math.max(horiz, vert) / lo : Number.POSITIVE_INFINITY
}

/** Warp output size that keeps the detected page's own proportions. */
export function quadSize(c: DocCornerPoints): { width: number; height: number } {
  const p = quadCorners(c)
  const dist = (a: CornerPoint, b: CornerPoint) => Math.hypot(b.x - a.x, b.y - a.y)
  return {
    width: Math.max(1, Math.round(Math.max(dist(p[0], p[1]), dist(p[3], p[2])))),
    height: Math.max(1, Math.round(Math.max(dist(p[0], p[3]), dist(p[1], p[2])))),
  }
}

/**
 * The region suggested when nothing plausible was detected: a centred rectangle
 * inset from the frame. It is a starting point for the editor's corner handles,
 * never an automatic crop.
 */
export function centeredInsetQuad(width: number, height: number, inset = 0.1): DocCornerPoints {
  const ix = width * inset
  const iy = height * inset
  return {
    topLeftCorner: { x: ix, y: iy },
    topRightCorner: { x: width - ix, y: iy },
    bottomRightCorner: { x: width - ix, y: height - iy },
    bottomLeftCorner: { x: ix, y: height - iy },
  }
}

function distToSegment(p: CornerPoint, q: CornerPoint, x: number, y: number): number {
  const dx = q.x - p.x
  const dy = q.y - p.y
  const len = dx * dx + dy * dy
  const t = len ? Math.min(1, Math.max(0, ((x - p.x) * dx + (y - p.y) * dy) / len)) : 0
  return Math.hypot(x - (p.x + t * dx), y - (p.y + t * dy))
}

function insidePolygon(points: CornerPoint[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    if (a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-6) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Compare the interior of a candidate quad with the ring of frame around it,
 * using single-channel 8-bit pixel data. Paper is both lighter than the table
 * and uniform, so a genuine detection shows a clear gain and a mostly-bright
 * interior; wood grain, cast shadow and merged object blobs do not.
 */
export function luminanceStats(
  data: Uint8Array,
  width: number,
  height: number,
  corners: DocCornerPoints,
  options: { marginInner: number; marginOuter: number; minGain: number }
): { gain: number; bright: number } {
  const points = quadCorners(corners)
  const outer = options.marginOuter
  const minX = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)) - outer))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...points.map(p => p.x)) + outer))
  const minY = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)) - outer))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map(p => p.y)) + outer))
  const step = Math.max(1, Math.round(Math.max(maxX - minX, maxY - minY) / 90))

  const inside: number[] = []
  const outside: number[] = []
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      let nearest = Number.POSITIVE_INFINITY
      for (let i = 0; i < 4; i++) {
        nearest = Math.min(nearest, distToSegment(points[i], points[(i + 1) % 4], x, y))
      }
      const value = data[Math.round(x) + Math.round(y) * width]
      if (insidePolygon(points, x, y)) {
        if (nearest > options.marginInner) inside.push(value)
      } else if (nearest <= outer) {
        outside.push(value)
      }
    }
  }
  if (!inside.length || !outside.length) return { gain: 0, bright: 0 }

  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length
  const outsideMean = mean(outside)
  const bright = inside.filter(v => v > outsideMean + options.minGain).length / inside.length
  return { gain: mean(inside) - outsideMean, bright }
}

function loadSource(image: string | HTMLImageElement | HTMLCanvasElement): Promise<HTMLImageElement | HTMLCanvasElement> {
  if (image instanceof HTMLCanvasElement) return Promise.resolve(image)
  if (image instanceof HTMLImageElement) {
    if (image.complete) return Promise.resolve(image)
    return new Promise((resolve, reject) => {
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Failed to load image'))
    })
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = image
  })
}

/**
 * Crop a rectangular region from an image, clamped to the image bounds.
 */
export async function applyCropToImage(
  image: string | HTMLImageElement | HTMLCanvasElement,
  bounds: CropBounds
): Promise<string> {
  const source = await loadSource(image)
  const width = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth
  const height = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight

  const x = Math.min(Math.max(0, Math.round(bounds.x)), width)
  const y = Math.min(Math.max(0, Math.round(bounds.y)), height)
  const cropWidth = Math.min(Math.max(1, Math.round(bounds.width)), width - x)
  const cropHeight = Math.min(Math.max(1, Math.round(bounds.height)), height - y)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Could not get canvas context')
  }
  canvas.width = cropWidth
  canvas.height = cropHeight
  ctx.drawImage(source, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
}
