import type { Student } from '@/types'

export const filterStudents = (students: Student[], searchTerm: string): Student[] =>
  students.filter(s =>
    `${s.first_name} ${s.last_name} ${s.student_id ?? ''} ${s.school_year ?? ''}`.toLowerCase().includes(searchTerm.toLowerCase())
  )

// Prefill student_id when the unmatched term looks like an ID (one token containing a digit)
export const studentIdFromSearchTerm = (searchTerm: string): string => {
  const term = searchTerm.trim()
  const looksLikeId = term.length > 0 && !term.includes(' ') && /\d/.test(term)
  return looksLikeId ? term : ''
}
