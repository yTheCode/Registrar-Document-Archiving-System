/**
 * Ambient types for the locally bundled scanner assets
 * (public/scanner/opencv.js and public/scanner/jscanify.js, loaded as classic
 * scripts — see src/utils/jscanifyScanner.ts).
 *
 * Only the members this app uses are declared; see the jscanify API docs.
 */

export interface CvPoint {
  x: number
  y: number
}

export interface CvRotatedRect {
  center: CvPoint
  size: { width: number; height: number }
  angle: number
  points: CvPoint[]
}

/**
 * Minimal OpenCV.js surface used by jscanify and by the document detector in
 * src/utils/jscanifyScanner.ts. Only the members this app calls are declared;
 * the remaining imgproc constants arrive through the index signature.
 */
export interface CvModule {
  onRuntimeInitialized?: () => void
  calledRun?: boolean
  Mat: new () => CvMat
  MatVector: new () => CvMatVector
  Size: new (width: number, height: number) => CvSize
  Scalar: new (v: number) => unknown
  imread(source: HTMLCanvasElement | HTMLImageElement): CvMat
  imshow(canvas: HTMLCanvasElement, mat: CvMat): void

  COLOR_RGBA2GRAY: number
  MORPH_RECT: number
  MORPH_CLOSE: number
  RETR_LIST: number
  CHAIN_APPROX_SIMPLE: number
  THRESH_BINARY: number
  THRESH_BINARY_INV: number
  THRESH_OTSU: number
  ADAPTIVE_THRESH_GAUSSIAN_C: number

  cvtColor(src: CvMat, dst: CvMat, code: number): void
  GaussianBlur(src: CvMat, dst: CvMat, ksize: CvSize, sigmaX: number): void
  medianBlur(src: CvMat, dst: CvMat, ksize: number): void
  threshold(src: CvMat, dst: CvMat, thresh: number, maxValue: number, type: number): number
  adaptiveThreshold(
    src: CvMat,
    dst: CvMat,
    maxValue: number,
    adaptiveMethod: number,
    thresholdType: number,
    blockSize: number,
    C: number
  ): void
  Canny(src: CvMat, dst: CvMat, low: number, high: number): void
  getStructuringElement(shape: number, ksize: CvSize): CvMat
  morphologyEx(src: CvMat, dst: CvMat, op: number, kernel: CvMat): void
  findContours(
    src: CvMat,
    contours: CvMatVector,
    hierarchy: CvMat,
    mode: number,
    method: number
  ): void
  contourArea(contour: CvMat): number
  arcLength(curve: CvMat, closed: boolean): number
  approxPolyDP(src: CvMat, dst: CvMat, epsilon: number, closed: boolean): void
  isContourConvex(contour: CvMat): boolean
  minAreaRect(contour: CvMat): CvRotatedRect

  [key: string]: unknown
}

export interface CvSize {
  width: number
  height: number
}

export interface CvMatVector {
  delete(): void
  size(): number
  get(index: number): CvMat
}

export interface CvMat {
  delete(): void
  rows: number
  cols: number
  /** Byte view of a single-channel 8-bit matrix (used for luminance sampling). */
  data?: Uint8Array
  data32S?: Int32Array
}

/** jscanify browser build constructor (window.jscanify). */
export interface JscanifyInstance {
  findPaperContour(img: CvMat): CvMat | null
  getCornerPoints(contour: CvMat): {
    topLeftCorner?: CvPoint
    topRightCorner?: CvPoint
    bottomLeftCorner?: CvPoint
    bottomRightCorner?: CvPoint
  }
  highlightPaper(
    image: HTMLCanvasElement | HTMLImageElement,
    options?: { color?: string; thickness?: number }
  ): HTMLCanvasElement
  extractPaper(
    image: HTMLCanvasElement | HTMLImageElement,
    resultWidth: number,
    resultHeight: number,
    cornerPoints?: {
      topLeftCorner: CvPoint
      topRightCorner: CvPoint
      bottomLeftCorner: CvPoint
      bottomRightCorner: CvPoint
    }
  ): HTMLCanvasElement | null
}

declare global {
  interface Window {
    cv?: CvModule
    jscanify?: new () => JscanifyInstance
  }
}
