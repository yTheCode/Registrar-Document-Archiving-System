import type { FileWithMetadata } from '@/types'

// Only raster images can be cropped/rotated; PDFs and Office files are skipped
export const isEditableImage = (f: FileWithMetadata) => {
  const fileName = f.file.name.toLowerCase()
  return Boolean(f.isDataUrl) ||
    fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ||
    fileName.endsWith('.png') || fileName.endsWith('.gif')
}
