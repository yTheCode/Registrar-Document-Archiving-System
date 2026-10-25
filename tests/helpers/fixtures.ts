import type { DocumentType, FileWithMetadata, Student } from '@/types'

/** Student row fixture — only the fields the import-scanner logic reads. */
export const makeStudent = (overrides: Partial<Student> = {}): Student => ({
  id: 1,
  student_id: '2024-00123',
  first_name: 'Juan',
  last_name: 'Dela Cruz',
  middle_name: null,
  school_year: '2025-2026',
  program_level: 'BSCS',
  created_at: '2026-01-05 08:00:00',
  ...overrides
})

/** Two document types: ids 1 and 2, so parseInt('1') matches the first. */
export const makeDocumentTypes = (): DocumentType[] => [
  { id: 1, name: 'Form 137', category: 'Student Records' },
  { id: 2, name: 'TOR', category: 'Student Records' }
]

const makeFile = (name: string): File => new File(['placeholder'], name, { type: 'image/jpeg' })

/** Queue entry fixture. `file: null` is not in the type but the page does build
 *  such rows (validateDocument guards `!f.file`), so overrides can pass it. */
export const makeFileEntry = (overrides: Partial<FileWithMetadata> = {}): FileWithMetadata => ({
  tempId: 'tmp-1',
  file: makeFile('scan-01.jpg'),
  filePath: 'C:/temp/scan-01.jpg',
  student: makeStudent(),
  documentTypeId: '1',
  academicYear: '2025-2026',
  remarks: '',
  dynamicMetadata: {},
  ...overrides
})

/** n queue entries named scan-1 … scan-n, used for page-window tests. */
export const makeFileList = (count: number): FileWithMetadata[] =>
  Array.from({ length: count }, (_, i) =>
    makeFileEntry({
      tempId: `tmp-${i + 1}`,
      file: makeFile(`scan-${i + 1}.jpg`),
      filePath: `C:/temp/scan-${i + 1}.jpg`
    })
  )
