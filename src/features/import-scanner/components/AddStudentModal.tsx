import type { FormEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'

interface NewStudentForm {
  student_id: string
  first_name: string
  last_name: string
  middle_name: string
  school_year: string
  program_level: string
}

interface AddStudentModalProps {
  newStudentForm: NewStudentForm
  setNewStudentForm: (form: NewStudentForm) => void
  addStudentMessage: { type: string; text: string }
  pendingForceAdd: boolean
  setPendingForceAdd: (v: boolean) => void
  isAddingStudent: boolean
  onCreate: (e: FormEvent) => void
  onClose: () => void
}

function AddStudentModal({ newStudentForm, setNewStudentForm, addStudentMessage, pendingForceAdd, setPendingForceAdd, isAddingStudent, onCreate, onClose }: AddStudentModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-bold text-[#182a43]">Add New Student</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#617084] transition hover:bg-[#f4f6f8]"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {addStudentMessage.text && (
          <div className={cn(
            'mb-4 rounded-md px-3 py-2 text-xs',
            addStudentMessage.type === 'error' && 'bg-[#fff0ef] text-[#b94843]'
          )}>
            {addStudentMessage.text}
            {pendingForceAdd && (
              <div className="mt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={isAddingStudent}
                  className="rounded border border-[#b94843] px-2.5 py-1 text-[10px] font-bold text-[#b94843] hover:bg-[#b94843] hover:text-white transition disabled:opacity-50"
                >
                  Add anyway?
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded border border-[#d7dde5] bg-white px-2.5 py-1 text-[10px] font-bold text-[#34445a] hover:bg-[#f4f6f8] transition"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={onCreate} className="space-y-4">
          <div>
            <label className="label-caps mb-1.5 block">Student ID</label>
            <input
              type="text"
              value={newStudentForm.student_id}
              onChange={(e) => { setPendingForceAdd(false); setNewStudentForm({ ...newStudentForm, student_id: e.target.value }) }}
              placeholder="Optional"
              className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps mb-1.5 block">
                First Name <span className="text-[#b94843]">*</span>
              </label>
              <input
                type="text"
                value={newStudentForm.first_name}
                onChange={(e) => { setPendingForceAdd(false); setNewStudentForm({ ...newStudentForm, first_name: e.target.value }) }}
                required
                className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
              />
            </div>
            <div>
              <label className="label-caps mb-1.5 block">
                Last Name <span className="text-[#b94843]">*</span>
              </label>
              <input
                type="text"
                value={newStudentForm.last_name}
                onChange={(e) => { setPendingForceAdd(false); setNewStudentForm({ ...newStudentForm, last_name: e.target.value }) }}
                required
                className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
              />
            </div>
          </div>

          <div>
            <label className="label-caps mb-1.5 block">Middle Name</label>
            <input
              type="text"
              value={newStudentForm.middle_name}
              onChange={(e) => { setPendingForceAdd(false); setNewStudentForm({ ...newStudentForm, middle_name: e.target.value }) }}
              placeholder="Optional"
              className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps mb-1.5 block">
                School Year <span className="text-[#b94843]">*</span>
              </label>
              <input
                type="text"
                value={newStudentForm.school_year}
                onChange={(e) => { setPendingForceAdd(false); setNewStudentForm({ ...newStudentForm, school_year: e.target.value }) }}
                required
                placeholder="e.g., 1996-1997"
                className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
              />
            </div>
            <div>
              <label className="label-caps mb-1.5 block">
                Program Level <span className="text-[#b94843]">*</span>
              </label>
              <select
                value={newStudentForm.program_level}
                onChange={(e) => { setPendingForceAdd(false); setNewStudentForm({ ...newStudentForm, program_level: e.target.value }) }}
                required
                className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
              >
                <option value="">Select...</option>
                <option value="College">College</option>
                <option value="Graduate School">Graduate School</option>
                <option value="Medicine">Medicine</option>
                <option value="Law">Law</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isAddingStudent}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isAddingStudent}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778] disabled:opacity-50"
            >
              {isAddingStudent ? 'Adding...' : pendingForceAdd ? 'Confirm Add' : 'Add Student'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddStudentModal
