import { Camera } from 'lucide-react'
import type { FileWithMetadata } from '@/types'

interface CaptureActionsProps {
  cameraStream: MediaStream | null
  retakeIndex: number | null
  filesWithMetadata: FileWithMetadata[]
  autoCropEnabled: boolean
  onCapturePhoto: () => void
  onFinishScanning: () => void
}

function CaptureActions({ cameraStream, retakeIndex, filesWithMetadata, autoCropEnabled, onCapturePhoto, onFinishScanning }: CaptureActionsProps) {
  return (
<div className="p-5 flex flex-col items-center gap-4">
  <button
    onClick={onCapturePhoto}
    disabled={!cameraStream}
    className="inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 text-sm font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778] disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <Camera size={20} />
    {retakeIndex !== null ? 'Capture Replacement' : 'Capture Document'}
  </button>
  <p className="text-[11px] text-[#718096]">
    {autoCropEnabled
      ? 'Each capture is cropped automatically to the detected page and the camera stays on — position the next page and capture again.'
      : 'Each capture is added to the queue exactly as framed and the camera stays on — position the next page and capture again.'}{' '}
    {autoCropEnabled
      ? 'Use Edit whenever you want to adjust the crop.'
      : 'You can still edit any capture manually below.'}
  </p>

  <button
    onClick={onFinishScanning}
    disabled={filesWithMetadata.length === 0}
    className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8] disabled:opacity-40 disabled:cursor-not-allowed"
  >
    Finish Scanning ({filesWithMetadata.length})
  </button>
</div>
  )
}

export default CaptureActions
