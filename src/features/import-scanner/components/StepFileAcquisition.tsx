import { Upload, Camera } from 'lucide-react'
import type { Workflow } from '@/types'

interface StepFileAcquisitionProps {
  workflow: Workflow | null
  isScanWorkflow: boolean
  onStartScan: () => void
  onFileSelect: () => void
}

function StepFileAcquisition({ workflow, isScanWorkflow, onStartScan, onFileSelect }: StepFileAcquisitionProps) {
  return (
    <div className="surface-card rounded-lg p-8 text-center">
      {isScanWorkflow ? (
        <>
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#eef5fb] mb-4">
            <Camera size={28} className="text-[#24558d]" />
          </div>
          <h3 className="text-base font-bold text-[#182a43] mb-2">
            {workflow === 'mixed-batch-scan' ? 'Mixed-Batch Document Scanner' : 'Single Student Document Scanner'}
          </h3>
          <p className="text-sm text-[#718096] mb-5">
            Scan the entire stack first — capture as many documents as you need, then tag them all at the end.
          </p>
          <button
            onClick={onStartScan}
            className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778]"
          >
            <Camera size={16} />
            Start Camera
          </button>
        </>
      ) : (
        <>
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#eef5fb] mb-4">
            <Upload size={28} className="text-[#24558d]" />
          </div>
          <h3 className="text-base font-bold text-[#182a43] mb-2">
            Select Files to Upload
          </h3>
          <p className="text-sm text-[#718096] mb-5">
            Choose image or PDF files from your computer
          </p>
          <button
            onClick={onFileSelect}
            className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778]"
          >
            <Upload size={16} />
            Choose Files
          </button>
        </>
      )}
    </div>
  )
}

export default StepFileAcquisition
