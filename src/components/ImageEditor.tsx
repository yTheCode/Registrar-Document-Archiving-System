import { useState, useRef, useEffect } from 'react'
import { RotateCcw, RotateCw, ZoomIn, ZoomOut, Crop, Scissors, RefreshCw, Sparkles, Move, Check } from 'lucide-react'
import { applyCropToImage, centeredInsetQuad } from '../utils/imageProcessing'
import type { DocCornerPoints } from '../utils/imageProcessing'
import { detectPaperQuad, extractPaperDataUrl, extractQuadDataUrl, initScanner } from '../utils/jscanifyScanner'
import type { PaperQuad } from '../utils/jscanifyScanner'
import { IMAGE_QUALITY } from '@/constants/image'
import { SCANNER_CONFIG } from '@/constants/scanner'
import './ImageEditor.css'

interface ImageEditorProps {
  imageData: string
  onSave: (editedImageData: string) => void
  onCancel: () => void
}

interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

type CornerKey = keyof DocCornerPoints

const CORNER_KEYS: CornerKey[] = ['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner']

/** Corner handle radius, in on-screen pixels, converted to image space when drawn. */
const HANDLE_CSS_SIZE = 9

interface QuadHandles {
  corners: DocCornerPoints
  /** A guess the user must confirm, not a trusted detection. */
  suggested: boolean
}

/** Draw `img` into a full-resolution canvas rotated by `rotation` degrees. */
function renderRotatedCanvas(img: HTMLImageElement, rotation: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get canvas context')

  if (rotation % 180 === 0) {
    canvas.width = img.width
    canvas.height = img.height
  } else {
    canvas.width = img.height
    canvas.height = img.width
  }

  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.drawImage(img, -img.width / 2, -img.height / 2)
  ctx.restore()
  return canvas
}

function ImageEditor({ imageData, onSave, onCancel }: ImageEditorProps) {
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  // The capture as it was handed to the editor. Never overwritten — Reset All
  // returns to it, and it is only committed when the user presses Save Changes.
  const originalImageDataRef = useRef<string>(imageData)

  const [rotation, setRotation] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [isCropping, setIsCropping] = useState(false)
  const [cropMode, setCropMode] = useState(false)
  const [isAutoDetecting, setIsAutoDetecting] = useState(false)
  const [autoCropError, setAutoCropError] = useState('')
  const [autoCropInfo, setAutoCropInfo] = useState('')

  // Crop rectangle in display canvas pixel coordinates
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0, y: 0, width: 0, height: 0 })
  const [isDraggingCrop, setIsDraggingCrop] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  // Draggable document corners, in working-image pixel space. The crop and the
  // perspective warp are only applied when the user confirms them.
  const [quad, setQuad] = useState<QuadHandles | null>(null)
  const [isWarping, setIsWarping] = useState(false)
  const [dragCorner, setDragCorner] = useState<CornerKey | null>(null)
  // Sizes needed to place the corner overlay exactly on top of the canvas.
  const [stage, setStage] = useState({ canvasWidth: 0, canvasHeight: 0, imageWidth: 0, imageHeight: 0 })

  const drawCanvas = () => {
    if (!displayCanvasRef.current || !imageRef.current) return

    const canvas = displayCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = imageRef.current
    const maxWidth = 800
    const maxHeight = 600

    // Calculate display size maintaining aspect ratio
    let displayWidth = img.width
    let displayHeight = img.height

    if (rotation % 180 !== 0) {
      displayWidth = img.height
      displayHeight = img.width
    }

    const scale = Math.min(maxWidth / displayWidth, maxHeight / displayHeight, 1)

    canvas.width = displayWidth * scale * zoom
    canvas.height = displayHeight * scale * zoom

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(zoom * scale, zoom * scale)
    ctx.drawImage(img, -img.width / 2, -img.height / 2)
    ctx.restore()

    setStage(prev => prev.canvasWidth === canvas.width && prev.imageWidth === img.width
      ? prev
      : { canvasWidth: canvas.width, canvasHeight: canvas.height, imageWidth: img.width, imageHeight: img.height })
  }

  /**
   * Replace the working image. Callers pass pixels that already contain any
   * rotation, so the view orientation resets to 0 here — that is what keeps a
   * document from being rotated twice (once by jscanify, once on save).
   */
  const setWorkingImage = (dataUrl: string, onLoaded?: () => void) => {
    const img = new Image()
    img.onload = () => {
      imageRef.current = img
      setRotation(0)
      setZoom(1)
      setCropMode(false)
      setCropRect({ x: 0, y: 0, width: 0, height: 0 })
      // Corners are expressed in the previous image's pixels.
      setQuad(null)
      setImageLoaded(true)
      drawCanvas()
      onLoaded?.()
    }
    img.src = dataUrl
  }

  useEffect(() => {
    originalImageDataRef.current = imageData
    setWorkingImage(imageData)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageData])

  useEffect(() => {
    if (imageLoaded) {
      drawCanvas()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation, zoom, imageLoaded])

  const handleRotateLeft = () => setRotation(prev => (prev - 90 + 360) % 360)

  const handleRotateRight = () => setRotation(prev => (prev + 90) % 360)

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.1, 3))

  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.1, 0.5))

  const handleReset = () => {
    setAutoCropError('')
    setAutoCropInfo('')
    setDragCorner(null)
    setWorkingImage(originalImageDataRef.current)
  }

  const handleStartCrop = () => {
    setCropMode(true)
    setCropRect({ x: 0, y: 0, width: 0, height: 0 })
  }

  /**
   * Locate the page on the given canvas. `apply` crops straight away only when
   * the detection is trustworthy; otherwise the result — a weak detection or the
   * centred inset region — is returned as corners for the user to adjust.
   */
  const findQuad = (canvas: HTMLCanvasElement): { detected: PaperQuad | null; handles: QuadHandles } => {
    const detected = detectPaperQuad(canvas, { maxSide: SCANNER_CONFIG.CAPTURE_ANALYSIS_MAX_SIDE })
    if (detected && detected.confident) return { detected, handles: { corners: detected.corners, suggested: false } }
    return {
      detected,
      handles: {
        corners: detected ? detected.corners : centeredInsetQuad(canvas.width, canvas.height, SCANNER_CONFIG.FALLBACK_INSET_RATIO),
        suggested: true,
      },
    }
  }

  /**
   * Detect, and when `apply` is set straighten the page immediately. Without it
   * the corners are only offered as draggable handles, so nothing is ever cropped
   * on an unsure detection.
   */
  const runDetection = (apply: boolean) => {
    const img = imageRef.current
    if (!img || isAutoDetecting) return

    setIsAutoDetecting(true)
    setAutoCropError('')
    setAutoCropInfo('')

    void (async () => {
      try {
        await initScanner()

        // Detect on the currently displayed orientation, then bake that
        // rotation into the working image so the corners share one pixel space.
        const rotated = renderRotatedCanvas(img, rotation)
        const { detected, handles } = findQuad(rotated)
        const confidence = detected ? Math.round(detected.confidence * 100) : 0

        if (apply && !handles.suggested) {
          const extracted = extractPaperDataUrl(rotated, detected!)
          if (!extracted) {
            setAutoCropError('The document could not be extracted. Please use Manual Crop instead.')
            return
          }
          setWorkingImage(extracted, () =>
            setAutoCropInfo('Document detected and straightened. Adjust below if needed — manual edits take precedence.')
          )
          return
        }

        setWorkingImage(rotated.toDataURL('image/jpeg', IMAGE_QUALITY), () => {
          setQuad(handles)
          setAutoCropInfo(
            detected
              ? `Only ${confidence}% sure about the page edges${apply ? ', so nothing was cropped yet' : ''}. Drag the four corners onto the document, then Apply Corners.`
              : 'No page edges found. Drag the four corners onto the document, then Apply Corners.'
          )
        })
      } catch (error) {
        console.error('Auto-crop failed:', error)
        setAutoCropError('Automatic detection is unavailable right now. Please use Manual Crop.')
      } finally {
        setIsAutoDetecting(false)
      }
    })()
  }

  const runAutoCrop = () => runDetection(false)  // Changed from true to false - shows corners instead of immediate crop

  const handleShowCorners = () => runDetection(false)

  const applyQuadCrop = () => {
    const img = imageRef.current
    if (!img || !quad || isWarping) return

    setIsWarping(true)
    try {
      const warped = extractQuadDataUrl(img, quad.corners)
      if (!warped) {
        setAutoCropError('The crop could not be applied. Adjust the corners and try again.')
        return
      }
      setWorkingImage(warped, () =>
        setAutoCropInfo(quad.suggested
          ? 'Cropped to the corners you set. Check the result before saving.'
          : 'Document straightened.')
      )
    } finally {
      setIsWarping(false)
    }
  }

  /** Pointer position in working-image pixels, from a client coordinate pair. */
  const imagePoint = (clientX: number, clientY: number) => {
    const canvas = displayCanvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return null
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    // Rotation and zoom are locked while handles are shown, so one linear
    // mapping from the rendered box back to image pixels stays exact.
    const x = ((clientX - rect.left) / rect.width) * canvas.width
    const y = ((clientY - rect.top) / rect.height) * canvas.height
    const k = img.width / canvas.width
    
    // Calculate handle radius in image space to constrain corners within valid bounds
    const handleRadiusImage = HANDLE_CSS_SIZE * k
    
    // Constrain coordinates to keep handles visible within image bounds
    const constrainedX = Math.min(img.width - handleRadiusImage, Math.max(handleRadiusImage, x * k))
    const constrainedY = Math.min(img.height - handleRadiusImage, Math.max(handleRadiusImage, y * k))
    
    return {
      x: constrainedX,
      y: constrainedY,
    }
  }

  useEffect(() => {
    if (!dragCorner) return
    const onMove = (e: MouseEvent) => {
      const point = imagePoint(e.clientX, e.clientY)
      if (!point) return
      setQuad(prev => (prev ? { ...prev, corners: { ...prev.corners, [dragCorner]: point } } : prev))
    }
    const onUp = () => setDragCorner(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragCorner])

  const canvasPoint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = displayCanvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    // Canvas pixels and CSS pixels can differ; map through the rendered box so
    // the overlay and the crop coordinates stay aligned.
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!cropMode) return
    const point = canvasPoint(e)
    if (!point) return

    setIsDraggingCrop(true)
    setDragStart(point)
    setCropRect({ ...point, width: 0, height: 0 })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingCrop || !cropMode) return
    const point = canvasPoint(e)
    if (!point) return

    const width = point.x - dragStart.x
    const height = point.y - dragStart.y

    setCropRect({
      x: width > 0 ? dragStart.x : point.x,
      y: height > 0 ? dragStart.y : point.y,
      width: Math.abs(width),
      height: Math.abs(height),
    })
  }

  const handleMouseUp = () => setIsDraggingCrop(false)

  const applyCrop = async () => {
    const canvas = displayCanvasRef.current
    const img = imageRef.current
    if (!canvas || !img || cropRect.width === 0 || cropRect.height === 0) return

    setIsCropping(true)
    try {
      // Bake the current orientation, then crop in that same space: a manual
      // selection always overrides the earlier automatic crop.
      const rotated = renderRotatedCanvas(img, rotation)
      const factor = canvas.width / rotated.width
      const cropped = await applyCropToImage(rotated, {
        x: cropRect.x / factor,
        y: cropRect.y / factor,
        width: cropRect.width / factor,
        height: cropRect.height / factor,
      })
      setWorkingImage(cropped)
    } catch (error) {
      console.error('Crop failed:', error)
      setAutoCropError('Crop failed. Please try again.')
    } finally {
      setIsCropping(false)
    }
  }

  const handleSave = () => {
    const img = imageRef.current
    if (!img) return

    try {
      // Single rotation at export time, at the capture's original resolution
      const outputCanvas = renderRotatedCanvas(img, rotation)
      onSave(outputCanvas.toDataURL('image/jpeg', IMAGE_QUALITY))
    } catch (error) {
      console.error('Save failed:', error)
      setAutoCropError('The image could not be saved. Please try again.')
    }
  }

  return (
    <div className="image-editor-overlay">
      <div className="image-editor-modal">
        <div className="image-editor-header">
          <h2>Edit Document Image</h2>
          <button onClick={onCancel} className="close-btn" aria-label="Close editor">×</button>
        </div>

        {autoCropError && (
          <div className="mx-4 mt-3 rounded-md bg-[#fdf0ef] px-3 py-2 text-xs font-semibold text-[#b94843]">
            {autoCropError}
          </div>
        )}
        {!autoCropError && autoCropInfo && (
          <div className="mx-4 mt-3 rounded-md bg-[#eef7ee] px-3 py-2 text-xs font-semibold text-[#2f6b3a]">
            {autoCropInfo}
          </div>
        )}

        <div className="image-editor-content">
          <div className="canvas-container">
            <div className="canvas-stage">
              <canvas
                ref={displayCanvasRef}
                className={`edit-canvas ${cropMode ? 'crop-active' : ''}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />
              {cropMode && cropRect.width > 0 && (
                <div
                  className="crop-overlay"
                  style={{
                    left: `${cropRect.x}px`,
                    top: `${cropRect.y}px`,
                    width: `${cropRect.width}px`,
                    height: `${cropRect.height}px`
                  }}
                >
                  <div className="crop-border"></div>
                  <div className="crop-info">
                    {Math.round(cropRect.width)} × {Math.round(cropRect.height)}
                  </div>
                </div>
              )}
              {quad && stage.canvasWidth > 0 && (
                <svg
                  className="quad-overlay"
                  width={stage.canvasWidth}
                  height={stage.canvasHeight}
                  viewBox={`0 0 ${stage.imageWidth} ${stage.imageHeight}`}
                  aria-label="Document corner handles"
                >
                  <polygon
                    className={`quad-shape ${quad.suggested ? 'quad-suggested' : ''}`}
                    points={CORNER_KEYS.map(k => `${quad.corners[k].x},${quad.corners[k].y}`).join(' ')}
                  />
                  {CORNER_KEYS.map(key => (
                    <circle
                      key={key}
                      className={`quad-handle ${quad.suggested ? 'quad-suggested' : ''}`}
                      cx={quad.corners[key].x}
                      cy={quad.corners[key].y}
                      r={HANDLE_CSS_SIZE * stage.imageWidth / stage.canvasWidth}
                      onMouseDown={e => {
                        e.preventDefault()
                        setDragCorner(key)
                      }}
                    />
                  ))}
                </svg>
              )}
            </div>
          </div>

          <div className="editor-controls">
            <div className="control-group">
              <label>Rotation</label>
              <div className="button-group">
                <button
                  onClick={handleRotateLeft}
                  className="control-btn"
                  aria-label="Rotate left 90 degrees"
                  disabled={cropMode || Boolean(quad)}
                >
                  <RotateCcw size={18} />
                  <span>Rotate Left</span>
                </button>
                <button
                  onClick={handleRotateRight}
                  className="control-btn"
                  aria-label="Rotate right 90 degrees"
                  disabled={cropMode || Boolean(quad)}
                >
                  <RotateCw size={18} />
                  <span>Rotate Right</span>
                </button>
              </div>
              <span className="control-value">{rotation}°</span>
            </div>

            <div className="control-group">
              <label>Zoom</label>
              <div className="button-group">
                <button
                  onClick={handleZoomOut}
                  className="control-btn"
                  aria-label="Zoom out"
                  disabled={cropMode || Boolean(quad)}
                >
                  <ZoomOut size={18} />
                  <span>Zoom Out</span>
                </button>
                <button
                  onClick={handleZoomIn}
                  className="control-btn"
                  aria-label="Zoom in"
                  disabled={cropMode || Boolean(quad)}
                >
                  <ZoomIn size={18} />
                  <span>Zoom In</span>
                </button>
              </div>
              <span className="control-value">{(zoom * 100).toFixed(0)}%</span>
            </div>

            <div className="control-group">
              <label>Crop</label>
              <button
                onClick={runAutoCrop}
                className="control-btn success-btn"
                aria-label="Auto-detect and crop document edges"
                disabled={cropMode || isAutoDetecting || isWarping}
              >
                <Sparkles size={18} />
                <span>{isAutoDetecting ? 'Detecting...' : 'Auto-Crop'}</span>
              </button>
              {!quad ? (
                <button
                  onClick={handleShowCorners}
                  className="control-btn"
                  aria-label="Show adjustable document corners"
                  disabled={cropMode || isAutoDetecting || isWarping}
                >
                  <Move size={18} />
                  <span>Adjust Corners</span>
                </button>
              ) : (
                <div className="button-group">
                  <button
                    onClick={applyQuadCrop}
                    className="control-btn success-btn"
                    aria-label="Crop and straighten to the selected corners"
                    disabled={isWarping || dragCorner !== null}
                  >
                    <Check size={18} />
                    <span>{isWarping ? 'Cropping...' : 'Apply Corners'}</span>
                  </button>
                  <button
                    onClick={() => setQuad(null)}
                    className="control-btn"
                    aria-label="Hide document corners"
                  >
                    <span>Clear</span>
                  </button>
                </div>
              )}
              {!cropMode ? (
                <button
                  onClick={handleStartCrop}
                  className="control-btn crop-btn"
                  aria-label="Start manual crop"
                  disabled={Boolean(quad)}
                >
                  <Crop size={18} />
                  <span>Manual Crop</span>
                </button>
              ) : (
                <div className="button-group">
                  <button
                    onClick={applyCrop}
                    className="control-btn success-btn"
                    aria-label="Apply crop"
                    disabled={cropRect.width === 0 || isCropping}
                  >
                    <Scissors size={18} />
                    <span>{isCropping ? 'Cropping...' : 'Apply'}</span>
                  </button>
                  <button
                    onClick={() => {
                      setCropMode(false)
                      setCropRect({ x: 0, y: 0, width: 0, height: 0 })
                    }}
                    className="control-btn"
                    aria-label="Cancel crop"
                  >
                    <span>Cancel</span>
                  </button>
                </div>
              )}
            </div>

            <div className="control-group">
              <label>Reset</label>
              <button
                onClick={handleReset}
                className="control-btn reset-btn"
                aria-label="Reset all changes"
              >
                <RefreshCw size={18} />
                <span>Reset All</span>
              </button>
            </div>
          </div>
        </div>

        <div className="image-editor-footer">
          <button onClick={onCancel} className="secondary-button">
            Cancel
          </button>
          <button onClick={handleSave} className="primary-button">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImageEditor
