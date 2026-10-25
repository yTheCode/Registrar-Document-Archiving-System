import { describe, expect, it } from 'vitest'
import { getReviewWindow } from '@/features/import-scanner/lib/queueHelpers'
import { makeFileList } from '../../../helpers/fixtures'

const tempIds = (files: ReturnType<typeof makeFileList>) => files.map(f => f.tempId)

describe('getReviewWindow', () => {
  it('windows the first page from offset 0 (5 per page)', () => {
    const { start, slice } = getReviewWindow(makeFileList(12), 1)
    expect(start).toBe(0)
    expect(tempIds(slice)).toEqual(['tmp-1', 'tmp-2', 'tmp-3', 'tmp-4', 'tmp-5'])
  })

  it('steps the offset by the page size', () => {
    expect(getReviewWindow(makeFileList(12), 2).start).toBe(5)
    expect(tempIds(getReviewWindow(makeFileList(12), 2).slice)).toEqual(['tmp-6', 'tmp-7', 'tmp-8', 'tmp-9', 'tmp-10'])
  })

  it('returns the short last page', () => {
    const { start, slice } = getReviewWindow(makeFileList(12), 3)
    expect(start).toBe(10)
    expect(slice).toHaveLength(2)
  })

  it('clamps a page beyond the last one instead of returning nothing', () => {
    const files = makeFileList(12)
    expect(getReviewWindow(files, 99)).toEqual(getReviewWindow(files, 3))
  })

  it('clamps to the exact last page when the count divides evenly', () => {
    const files = makeFileList(10)
    expect(getReviewWindow(files, 3)).toEqual({ start: 5, slice: files.slice(5, 10) })
  })

  it('treats an empty queue as one page with an empty window', () => {
    expect(getReviewWindow([], 1)).toEqual({ start: 0, slice: [] })
    expect(getReviewWindow([], 4)).toEqual({ start: 0, slice: [] })
  })

  it('handles a single item and a queue that is exactly one page', () => {
    const one = makeFileList(1)
    expect(getReviewWindow(one, 1)).toEqual({ start: 0, slice: one })

    const five = makeFileList(5)
    expect(getReviewWindow(five, 1).slice).toHaveLength(5)
    // 5 items is one page, so page 2 clamps back to page 1
    expect(getReviewWindow(five, 2)).toEqual({ start: 0, slice: five })
    expect(getReviewWindow(five, 3)).toEqual({ start: 0, slice: five })
  })

  it('does not clamp the low end: page 0 yields a negative offset and an empty window', () => {
    expect(getReviewWindow(makeFileList(12), 0)).toEqual({ start: -5, slice: [] })
  })

  it('does not clamp negative pages at all: the negative offset slices from the end', () => {
    const { start, slice } = getReviewWindow(makeFileList(12), -1)
    expect(start).toBe(-10)
    expect(tempIds(slice)).toEqual(['tmp-3', 'tmp-4', 'tmp-5', 'tmp-6', 'tmp-7'])
  })

  it('never mutates the input array', () => {
    const files = makeFileList(7)
    const before = tempIds(files)
    getReviewWindow(files, 2)
    expect(tempIds(files)).toEqual(before)
    expect(files).toHaveLength(7)
  })
})
