import { User } from 'lucide-react'
import { formatStudentYear } from '@/utils/format'
import { WORKFLOW_LABELS } from '@/features/import-scanner/lib/workflowLabels'
import type { Student, Workflow } from '@/types'

interface WorkflowBannerProps {
  workflow: Workflow | null
  step: 'mode' | 'selectStudent' | 'files' | 'camera' | 'details'
  isStudentWorkflow: boolean
  batchStudent: Student | null
  isProcessing: boolean
  onResetAll: () => void
  onChangeStudent: () => void
}

function WorkflowBanner({ workflow, step, isStudentWorkflow, batchStudent, isProcessing, onResetAll, onChangeStudent }: WorkflowBannerProps) {
  return (
    <>
      {workflow && step !== 'mode' && (
        <div className="mb-5 flex items-center justify-between rounded-lg border border-[#e1e5ea] bg-[#f8fafc] px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs text-[#536d89]">
            <span className="label-caps">Workflow</span>
            <span className="rounded-full bg-[#24558d] px-2.5 py-0.5 text-[11px] font-bold text-white">
              {WORKFLOW_LABELS[workflow]}
            </span>
            {isStudentWorkflow && batchStudent && step !== 'selectStudent' && (
              <span className="text-[#263950]">
                — {batchStudent.first_name} {batchStudent.last_name} ({formatStudentYear(batchStudent)})
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onResetAll}
            disabled={isProcessing}
            className="text-xs font-bold text-[#b94843] hover:underline disabled:opacity-50"
          >
            Start Over
          </button>
        </div>
      )}

      {/* Selected Student — persistent locked-student summary (student workflows only) */}
      {isStudentWorkflow && batchStudent && step !== 'selectStudent' && (
        <div className="mb-5 flex items-center justify-between rounded-lg border border-[#c5dff4] bg-[#eef5fb] px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-white p-2 text-[#24558d]">
              <User size={18} />
            </div>
            <div>
              <div className="label-caps text-[#536d89]">Selected Student</div>
              <div className="text-sm font-bold text-[#182a43]">
                {batchStudent.last_name}, {batchStudent.first_name}
                <span className="mono ml-2 text-xs font-normal text-[#536d89]">{formatStudentYear(batchStudent)}</span>
              </div>
              <div className="mt-0.5 text-xs text-[#536d89]">
                All documents added in this session will be archived under this student.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onChangeStudent}
            disabled={isProcessing}
            className="inline-flex items-center justify-center rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#a9c9e6] bg-white text-[#24558d] hover:bg-[#dceafb] disabled:opacity-50"
          >
            Change Student
          </button>
        </div>
      )}
    </>
  )
}

export default WorkflowBanner
