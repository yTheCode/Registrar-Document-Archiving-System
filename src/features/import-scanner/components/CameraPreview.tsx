import type { RefObject } from 'react'
import { cn } from '@/utils/cn'

interface CameraPreviewProps {
  videoRef: RefObject<HTMLVideoElement>
  overlayRef: RefObject<HTMLCanvasElement>
  autoCropEnabled: boolean
  scannerState: 'loading' | 'ready' | 'failed'
  documentFound: boolean
  edgesUncertain: boolean
}

function CameraPreview({ videoRef, overlayRef, autoCropEnabled, scannerState, documentFound, edgesUncertain }: CameraPreviewProps) {
  return (
    <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-contain"
      />
      {/* jscanify outline: same box as the video and the same letterboxing */}
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
      />
      <div className="absolute top-4 left-4 right-4 flex flex-wrap items-start gap-2">
        <div className="inline-block bg-black/60 backdrop-blur-sm rounded-md px-3 py-2">
          <p className="text-white text-xs font-medium">
            Position document in frame. Capture as many as you need — tagging comes after.
          </p>
        </div>
        <div className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[11px] font-bold backdrop-blur-sm',
          !autoCropEnabled
            ? 'bg-black/60 text-white/70'
            : scannerState === 'ready' && documentFound
            ? 'bg-[#14532d]/80 text-[#bbf7d0]'
            : scannerState === 'failed'
              ? 'bg-[#7f1d1d]/80 text-[#fecaca]'
              : scannerState === 'ready' && edgesUncertain
                ? 'bg-[#78350f]/80 text-[#fde68a]'
                : 'bg-black/60 text-white/70'
        )}>
          <span className={cn(
            'h-2 w-2 rounded-full',
            !autoCropEnabled
              ? 'bg-white/50'
              : scannerState === 'ready' && documentFound
              ? 'bg-[#22c55e]'
              : scannerState === 'failed'
                ? 'bg-[#f87171]'
                : scannerState === 'ready' && edgesUncertain
                  ? 'bg-[#f59e0b]'
                  : 'bg-white/50'
          )} />
          {!autoCropEnabled && 'Auto-crop is OFF — plain capture'}
          {autoCropEnabled && scannerState === 'loading' && 'Starting document detection…'}
          {autoCropEnabled && scannerState === 'failed' && 'Auto-detection unavailable — capture and crop manually'}
          {autoCropEnabled && scannerState === 'ready' && (documentFound
            ? 'Document detected — press Capture'
            : edgesUncertain
              ? 'Edges are unsure — use Edit on this capture to adjust the corners'
              : 'Looking for document edges…')}
        </div>
      </div>
    </div>
  )
}

export default CameraPreview
