import { User, X, Search as SearchIcon, UserPlus } from 'lucide-react'
import { formatStudentYear } from '@/utils/format'
import type { Student } from '@/types'

interface SessionStudentPickerProps {
  onPick: (s: Student) => void
  currentStudent: Student | null
  setCurrentStudent: (s: Student | null) => void
  searchTerm: string
  setSearchTerm: (v: string) => void
  filteredStudents: Student[]
  openAddStudentForm: (onPick: (s: Student) => void) => void
}

function SessionStudentPicker({ onPick, currentStudent, setCurrentStudent, searchTerm, setSearchTerm, filteredStudents, openAddStudentForm }: SessionStudentPickerProps) {
  return (
    <div>
      {/* Show search bar OR selected student badge */}
      {currentStudent ? (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-[#c5dff4] bg-[#eef5fb] px-4 py-2.5">
          <User size={16} className="shrink-0 text-[#24558d]" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-[#182a43] truncate">
              {currentStudent.last_name}, {currentStudent.first_name}
            </div>
            <div className="mono text-[10px] text-[#536d89]">
              {formatStudentYear(currentStudent)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setCurrentStudent(null)
              setSearchTerm('')
            }}
            className="shrink-0 rounded p-1 text-[#536d89] hover:bg-[#dceafb] hover:text-[#182a43] transition"
            title="Clear selection"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <>
          <div className="relative mb-3">
            <SearchIcon size={15} className="absolute left-3 top-2.5 text-[#8a97a7]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, school year, or student ID..."
              autoFocus
              className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
            />
          </div>
          {searchTerm && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-[#d9dfe7]">
              {filteredStudents.length > 0 ? (
                filteredStudents.slice(0, 8).map(student => (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => {
                      onPick(student)
                      setSearchTerm('')
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[#f8fafc] border-b border-[#edf0f3] last:border-0"
                  >
                    <div className="text-sm font-bold text-[#263950]">
                      {student.last_name}, {student.first_name}
                    </div>
                    <div className="mono mt-0.5 text-[10px] text-[#8995a4]">
                      {formatStudentYear(student)}
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-3 text-center">
                  <div className="text-xs text-[#8a95a5]">No students found for "{searchTerm}"</div>
                  <button
                    type="button"
                    onClick={() => openAddStudentForm(onPick)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[#d7dde5] bg-white px-3 py-1.5 text-xs font-bold text-[#24558d] transition hover:bg-[#eef5fb]"
                  >
                    <UserPlus size={14} />
                    Add New Student
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default SessionStudentPicker
