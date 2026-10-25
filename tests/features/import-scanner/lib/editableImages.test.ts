import { describe, expect, it } from 'vitest'
import { isEditableImage } from '@/features/import-scanner/lib/editableImages'
import type { FileWithMetadata } from '@/types'
import { makeFileEntry } from '../../../helpers/fixtures'

const entryNamed = (name: string, extra: Partial<FileWithMetadata> = {}) =>
  makeFileEntry({ file: new File(['x'], name), ...extra })

describe('isEditableImage', () => {
  it('accepts the raster extensions', () => {
    for (const name of ['a.jpg', 'a.jpeg', 'a.png', 'a.gif']) {
      expect(isEditableImage(entryNamed(name))).toBe(true)
    }
  })

  it('ignores the case of the extension', () => {
    expect(isEditableImage(entryNamed('SCAN-01.JPG'))).toBe(true)
    expect(isEditableImage(entryNamed('scan.PNG'))).toBe(true)
  })

  it('skips PDFs and Office documents', () => {
    for (const name of ['form137.pdf', 'tor.docx', 'grades.xlsx', 'deck.pptx']) {
      expect(isEditableImage(entryNamed(name))).toBe(false)
    }
  })

  it('skips video and extension-less names', () => {
    expect(isEditableImage(entryNamed('clip.mp4'))).toBe(false)
    expect(isEditableImage(entryNamed('no-extension'))).toBe(false)
    expect(isEditableImage(entryNamed(''))).toBe(false)
  })

  it('does not match an extension that only ends like an image', () => {
    expect(isEditableImage(entryNamed('photo.jpg.backup'))).toBe(false)
    expect(isEditableImage(entryNamed('images.gifv'))).toBe(false)
  })

  it('trusts isDataUrl even when the name looks uneditable', () => {
    expect(isEditableImage(entryNamed('scan.pdf', { isDataUrl: true }))).toBe(true)
    expect(isEditableImage(entryNamed('capture-0001', { isDataUrl: true }))).toBe(true)
  })

  it('returns a boolean, not the extension check result', () => {
    expect(typeof isEditableImage(entryNamed('a.png'))).toBe('boolean')
    expect(typeof isEditableImage(entryNamed('a.pdf'))).toBe('boolean')
  })

  it('is false for a data-URL entry that has the flag set to false', () => {
    expect(isEditableImage(entryNamed('scan.pdf', { isDataUrl: false }))).toBe(false)
    expect(isEditableImage(entryNamed('scan.jpg', { isDataUrl: false }))).toBe(true)
  })

  it('throws when there is no File to inspect (filePath-only rows)', () => {
    // characterize-only, hard rule 1: the page gates Edit on rows that always carry a File
    expect(() => isEditableImage(makeFileEntry({ file: null as unknown as File }))).toThrow(TypeError)
  })
})
