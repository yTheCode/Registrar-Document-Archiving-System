import { describe, expect, it } from 'vitest'
import { filterStudents, studentIdFromSearchTerm } from '@/features/import-scanner/lib/studentSearch'
import { makeStudent } from '../../../helpers/fixtures'

const students = [
  makeStudent({
    id: 1,
    student_id: '2024-00123',
    first_name: 'Juan',
    last_name: 'Dela Cruz',
    school_year: '2025-2026'
  }),
  makeStudent({ id: 2, student_id: '2023-00456', first_name: 'Maria', last_name: 'Santos', school_year: '2024-2025' }),
  makeStudent({ id: 3, student_id: null, first_name: 'Ana', last_name: 'Reyes', school_year: null })
]

const ids = (term: string) => filterStudents(students, term).map(s => s.id)

describe('filterStudents', () => {
  it('matches the first name case-insensitively', () => {
    expect(ids('juan')).toEqual([1])
    expect(ids('JUAN')).toEqual([1])
  })

  it('matches the last name as a substring', () => {
    expect(ids('san')).toEqual([2])
  })

  it('matches the student id', () => {
    expect(ids('00456')).toEqual([2])
    expect(ids('2024-001')).toEqual([1])
  })

  it('matches the school year', () => {
    expect(ids('2024-2025')).toEqual([2])
  })

  it('returns everything for an empty term', () => {
    expect(ids('')).toEqual([1, 2, 3])
  })

  it('does not trim the term, so a leading space never matches', () => {
    expect(ids(' juan')).toEqual([])
  })

  it('returns nothing when no field contains the term', () => {
    expect(ids('zzz')).toEqual([])
  })

  it('tolerates null student id and school year', () => {
    expect(ids('ana')).toEqual([3])
    expect(ids('reyes')).toEqual([3])
  })

  it('searches the concatenated field, so a term spanning two fields matches', () => {
    // "Juan Dela Cruz 2024-00123 2025-2026" — the name/id boundary is a real substring
    expect(ids('Cruz 2024-00123')).toEqual([1])
  })

  it('matches an empty student list to an empty result', () => {
    expect(filterStudents([], 'juan')).toEqual([])
  })

  it('keeps the original objects in the result', () => {
    expect(filterStudents(students, 'Maria')[0]).toBe(students[1])
  })
})

describe('studentIdFromSearchTerm', () => {
  it('prefills a bare numeric term', () => {
    expect(studentIdFromSearchTerm('202400123')).toBe('202400123')
  })

  it('trims surrounding whitespace first', () => {
    expect(studentIdFromSearchTerm('  202400123  ')).toBe('202400123')
  })

  it('accepts a mixed token as long as it holds a digit and no space', () => {
    expect(studentIdFromSearchTerm('CS-101')).toBe('CS-101')
  })

  it('rejects a name-like term without digits', () => {
    expect(studentIdFromSearchTerm('Juan')).toBe('')
  })

  it('rejects a multi-word term even when it contains digits', () => {
    expect(studentIdFromSearchTerm('Juan 123')).toBe('')
  })

  it('rejects an empty term and a whitespace-only term', () => {
    expect(studentIdFromSearchTerm('')).toBe('')
    expect(studentIdFromSearchTerm('     ')).toBe('')
  })

  it('accepts a single digit', () => {
    expect(studentIdFromSearchTerm('7')).toBe('7')
  })
})
