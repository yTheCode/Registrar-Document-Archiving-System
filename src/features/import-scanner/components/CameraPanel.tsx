import { cn } from '@/utils/cn'
import { cameraQualityKey } from '@/utils/cameraCapabilities'
import type { CameraQuality } from '@/utils/cameraCapabilities'
import type { FileWithMetadata } from '@/types'

interface CameraPanelProps {
  deviceId: string
  videoDevices: MediaDeviceInfo[]
  selectedQuality: string
  qualityOptions: CameraQuality[]
  activeResolution: string
  cameraStream: MediaStream | null
  autoCropEnabled: boolean
  retakeIndex: number | null
  filesWithMetadata: FileWithMetadata[]
  onSwitchCamera: (id: string) => void
  onQualityChange: (key: string) => Promise<void> | void
  onToggleAutoCrop: () => void
  onCancelCamera: () => void
}

function CameraPanel({ deviceId, videoDevices, selectedQuality, qualityOptions, activeResolution, cameraStream, autoCropEnabled, retakeIndex, filesWithMetadata, onSwitchCamera, onQualityChange, onToggleAutoCrop, onCancelCamera }: CameraPanelProps) {
  return (
<div className="flex flex-wrap items-end gap-4 border-b border-[#e8ebef] px-5 py-3">
  <div>
    <label className="label-caps mb-1 block">Camera</label>
    <select
      value={deviceId}
      onChange={(e) => onSwitchCamera(e.target.value)}
      className="h-9 rounded-md border border-[#d9dfe7] bg-white px-2 text-xs text-[#47576b] outline-none focus:border-[#5688bd]"
    >
      <option value="">Default camera</option>
      {videoDevices.map((d, i) => (
        <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
      ))}
    </select>
  </div>
  <div>
    <label className="label-caps mb-1 block">Quality</label>
    <select
      value={selectedQuality}
      onChange={(e) => { void onQualityChange(e.target.value) }}
      disabled={!cameraStream || qualityOptions.length === 0}
      className="h-9 rounded-md border border-[#d9dfe7] bg-white px-2 text-xs text-[#47576b] outline-none focus:border-[#5688bd] disabled:opacity-50"
    >
      {qualityOptions.length === 0 && <option value="">Reading camera capabilities…</option>}
      {qualityOptions.map(q => (
        <option key={cameraQualityKey(q)} value={cameraQualityKey(q)}>{q.label}</option>
      ))}
    </select>
    {activeResolution && (
      <div className="mono mt-1 text-[10px] text-[#536d89]">Live: {activeResolution}</div>
    )}
  </div>
  <div>
    <label className="label-caps mb-1 block">Auto-Crop Scan</label>
    <button
      type="button"
      onClick={onToggleAutoCrop}
      aria-pressed={autoCropEnabled}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-bold transition focus-ring',
        autoCropEnabled
          ? 'border-[#2b9b72] bg-[#e5f5ee] text-[#22735a]'
          : 'border-[#d9dfe7] bg-white text-[#718096] hover:bg-[#f4f6f8]'
      )}
    >
      <span className={cn(
        'relative inline-flex h-4 w-7 items-center rounded-full transition',
        autoCropEnabled ? 'bg-[#2b9b72]' : 'bg-[#c3ccd6]'
      )}>
        <span className={cn(
          'absolute h-3 w-3 rounded-full bg-white transition-all',
          autoCropEnabled ? 'left-3.5' : 'left-0.5'
        )} />
      </span>
      {autoCropEnabled ? 'On' : 'Off'}
    </button>
  </div>
  <div className="ml-auto flex items-center gap-3">
    {retakeIndex !== null && (
      <span className="rounded-full bg-[#fff6df] px-3 py-1 text-[11px] font-bold text-[#b17f22]">
        Retaking document {retakeIndex + 1} — its details will be kept
      </span>
    )}
    <span className="text-xs text-[#718096]">
      Scanned: {filesWithMetadata.length} document{filesWithMetadata.length !== 1 ? 's' : ''}
    </span>
    <button
      onClick={onCancelCamera}
      className="rounded-md px-3 py-1.5 text-xs font-bold text-[#536d89] hover:bg-[#f1f4f7]"
    >
      Cancel
    </button>
  </div>
</div>
  )
}

export default CameraPanel
