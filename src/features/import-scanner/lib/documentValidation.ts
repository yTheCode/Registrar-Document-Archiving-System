import type { DocumentType, FileWithMetadata } from '@/types'

// Single source of truth for document readiness. Used by the review table,
// ready counts, the Save button, and final batch validation.
export const validateDocument = (f: FileWithMetadata, documentTypes: DocumentType[]): string[] => {
  const errors: string[] = []
  if (!f.file && !f.filePath) errors.push('File missing')
  const dt = documentTypes.find(t => t.id === parseInt(f.documentTypeId))
  if (!dt) {
    errors.push('Document Type is missing')
    return errors
  }
  if (!f.student) errors.push('Student is required')
  return errors
}

export const isFileReady = (f: FileWithMetadata, documentTypes: DocumentType[]) =>
  validateDocument(f, documentTypes).length === 0
