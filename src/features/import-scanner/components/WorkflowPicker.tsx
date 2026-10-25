import { Upload, Camera, Users } from 'lucide-react'
import type { Workflow } from '@/types'

interface WorkflowPickerProps {
  onStartWorkflow: (wf: Workflow) => void
}

function WorkflowPicker({ onStartWorkflow }: WorkflowPickerProps) {
  return (
    <>
      <div className="surface-card rounded-lg p-5 mb-5">
        <div className="label-caps mb-3">Single Student Import</div>
        <p className="mb-4 text-xs text-[#718096]">
          For one known student — select the student first, then add all their documents.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => onStartWorkflow('single-student-upload')}
            className="flex items-center gap-4 rounded-lg border-2 border-[#e1e5ea] p-4 text-left transition hover:border-[#24558d] hover:bg-[#eef5fb]"
          >
            <div className="rounded-full bg-[#edf2f7] p-3 text-[#536d89]">
              <Upload size={20} />
            </div>
            <div>
              <div className="text-sm font-bold text-[#182a43]">Upload for One Student</div>
              <p className="mt-0.5 text-xs text-[#718096]">
                Select files from your computer
              </p>
            </div>
          </button>

          <button
            onClick={() => onStartWorkflow('single-student-scan')}
            className="flex items-center gap-4 rounded-lg border-2 border-[#e1e5ea] p-4 text-left transition hover:border-[#24558d] hover:bg-[#eef5fb]"
          >
            <div className="rounded-full bg-[#edf2f7] p-3 text-[#536d89]">
              <Camera size={20} />
            </div>
            <div>
              <div className="text-sm font-bold text-[#182a43]">Capture for One Student</div>
              <p className="mt-0.5 text-xs text-[#718096]">
                Use the webcam to scan documents
              </p>
            </div>
          </button>
        </div>
      </div>

      <div className="surface-card rounded-lg p-5">
        <div className="label-caps mb-3">Mixed-Batch Import</div>
        <p className="mb-4 text-xs text-[#718096]">
          For a mixed stack — upload or scan everything first, then tag each document and assign students afterward when required.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => onStartWorkflow('mixed-batch-upload')}
            className="flex items-center gap-4 rounded-lg border-2 border-[#e1e5ea] p-4 text-left transition hover:border-[#24558d] hover:bg-[#eef5fb]"
          >
            <div className="rounded-full bg-[#edf2f7] p-3 text-[#536d89]">
              <Users size={20} />
            </div>
            <div>
              <div className="text-sm font-bold text-[#182a43]">Upload Mixed Batch</div>
              <p className="mt-0.5 text-xs text-[#718096]">
                Select files from your computer
              </p>
            </div>
          </button>

          <button
            onClick={() => onStartWorkflow('mixed-batch-scan')}
            className="flex items-center gap-4 rounded-lg border-2 border-[#e1e5ea] p-4 text-left transition hover:border-[#24558d] hover:bg-[#eef5fb]"
          >
            <div className="rounded-full bg-[#edf2f7] p-3 text-[#536d89]">
              <Camera size={20} />
            </div>
            <div>
              <div className="text-sm font-bold text-[#182a43]">Capture Mixed Batch</div>
              <p className="mt-0.5 text-xs text-[#718096]">
                Continuously scan a stack, tag everything afterward
              </p>
            </div>
          </button>
        </div>
      </div>
    </>
  )
}

export default WorkflowPicker
