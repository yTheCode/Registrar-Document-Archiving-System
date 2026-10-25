import { PAGINATION } from '@/constants/pagination'
import type { FileWithMetadata } from '@/types'

export const getReviewWindow = (files: FileWithMetadata[], page: number) => {
  const totalPages = Math.max(1, Math.ceil(files.length / PAGINATION.REVIEW_PAGE_SIZE))
  const start = (Math.min(page, totalPages) - 1) * PAGINATION.REVIEW_PAGE_SIZE
  const slice = files.slice(start, start + PAGINATION.REVIEW_PAGE_SIZE)
  return { start, slice }
}
