import { describe, expect, it } from 'vitest'
import { isFileReady, validateDocument } from '@/features/import-scanner/lib/documentValidation'
import { makeDocumentTypes, makeFileEntry, makeStudent } from '../../../helpers/fixtures'

const types = makeDocumentTypes()

describe('validateDocument', () => {
  it('accepts a complete entry', () => {
    expect(validateDocument(makeFileEntry(), types)).toEqual([])
  })

  it('reports a missing document type and stops there', () => {
    const errors = validateDocument(makeFileEntry({ documentTypeId: '99', student: null }), types)
    expect(errors).toEqual(['Document Type is missing'])
  })

  it('reports an empty document type id', () => {
    expect(validateDocument(makeFileEntry({ documentTypeId: '' }), types)).toEqual(['Document Type is missing'])
  })

  it('accepts a null File as long as filePath is present', () => {
    const entry = makeFileEntry({ file: null as unknown as File })
    expect(validateDocument(entry, types)).toEqual([])
  })

  it('accepts a null filePath as long as File is present', () => {
    const entry = makeFileEntry({ filePath: '' })
    expect(validateDocument(entry, types)).toEqual([])
  })

  it('reports "File missing" only when both sources are absent', () => {
    const entry = makeFileEntry({ file: null as unknown as File, filePath: '' })
    expect(validateDocument(entry, types)).toEqual(['File missing'])
  })

  it('combines "File missing" with the metadata errors', () => {
    const entry = makeFileEntry({ file: null as unknown as File, filePath: '', student: null })
    expect(validateDocument(entry, types)).toEqual(['File missing', 'Student is required'])
  })

  it('requires a student', () => {
    expect(validateDocument(makeFileEntry({ student: null }), types)).toEqual(['Student is required'])
  })

  it('treats a student without an id as present', () => {
    const entry = makeFileEntry({ student: makeStudent({ student_id: null }) })
    expect(validateDocument(entry, types)).toEqual([])
  })

  it('parses the document type id leniently: whitespace, decimals and trailing text still match', () => {
    expect(validateDocument(makeFileEntry({ documentTypeId: ' 2 ' }), types)).toEqual([])
    expect(validateDocument(makeFileEntry({ documentTypeId: '2.9' }), types)).toEqual([])
    expect(validateDocument(makeFileEntry({ documentTypeId: '1abc' }), types)).toEqual([])
  })

  it('rejects non-decimal document type ids', () => {
    expect(validateDocument(makeFileEntry({ documentTypeId: 'abc' }), types)).toEqual(['Document Type is missing'])
    expect(validateDocument(makeFileEntry({ documentTypeId: '-1' }), types)).toEqual(['Document Type is missing'])
  })

  it('reports every type as missing when no document types are loaded', () => {
    expect(validateDocument(makeFileEntry(), [])).toEqual(['Document Type is missing'])
  })
})

describe('isFileReady', () => {
  it('is true exactly when validateDocument returns no errors', () => {
    expect(isFileReady(makeFileEntry(), types)).toBe(true)
    expect(isFileReady(makeFileEntry({ student: null }), types)).toBe(false)
    expect(isFileReady(makeFileEntry({ documentTypeId: '3' }), types)).toBe(false)
  })

  it('is false for an entry missing both file sources', () => {
    expect(isFileReady(makeFileEntry({ file: null as unknown as File, filePath: '' }), types)).toBe(false)
  })
})
