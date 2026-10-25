import type { detectPaperQuad } from '@/utils/jscanifyScanner'

export const drawLiveOutline = (
  overlay: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  quad: ReturnType<typeof detectPaperQuad>,
  analysisWidth: number
) => {
  if (!overlay || !video || !video.videoWidth || !video.videoHeight) return

  const ctx = overlay.getContext('2d')
  if (!ctx) return
  if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
    overlay.width = video.videoWidth
    overlay.height = video.videoHeight
  }
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  if (!quad) return

  // The canvas shares the video's box and letterboxes identically, so
  // intrinsic analysis pixels map straight onto the preview.
  const k = overlay.width / analysisWidth
  const points = [
    quad.corners.topLeftCorner,
    quad.corners.topRightCorner,
    quad.corners.bottomRightCorner,
    quad.corners.bottomLeftCorner,
  ]
  ctx.beginPath()
  ctx.moveTo(points[0].x * k, points[0].y * k)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x * k, points[i].y * k)
  ctx.closePath()
  ctx.lineWidth = Math.max(3, overlay.width / 320)
  // A guess is shown as a dashed outline: only a confident quad promises an
  // automatic crop, and the editor is where the user settles the corners.
  ctx.setLineDash(quad.confident ? [] : [overlay.width / 60, overlay.width / 90])
  ctx.strokeStyle = quad.confident ? '#22c55e' : '#f59e0b'
  ctx.stroke()
  ctx.setLineDash([])
}
