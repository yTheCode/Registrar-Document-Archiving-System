import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, formatStudentYear, formatTimestamp } from '@/utils/format'

afterEach(() => {
  vi.useRealTimers()
})

describe('formatDate', () => {
  it('renders an en-US short date', () => {
    // midday UTC so the local-day rollover cannot change the expected day
    expect(formatDate('2026-03-05T12:00:00Z')).toBe('Mar 5, 2026')
    expect(formatDate('2025-12-31T12:00:00Z')).toBe('Dec 31, 2025')
    expect(formatDate('2026-01-01T12:00:00Z')).toBe('Jan 1, 2026')
  })

  it('renders single-digit days without padding', () => {
    expect(formatDate('2026-09-09T12:00:00Z')).toBe('Sep 9, 2026')
  })

  it('renders a date-only string', () => {
    // '2026-06-15' is UTC midnight, so the local calendar day is Jun 14 or Jun 15
    // depending on the machine's zone; both are a real date, never the placeholder.
    expect(formatDate('2026-06-15')).toMatch(/^Jun 1[45], 2026$/)
  })

  it('returns the placeholder instead of throwing on an unparseable value', () => {
    // Updated in p1d cp1: this test used to pin the throwing behaviour (Q12).
    expect(formatDate('not-a-date')).toBe('Unknown date')
    expect(formatDate('2026-13-45')).toBe('Unknown date')
  })

  it('returns the placeholder for null, undefined, empty and blank input', () => {
    expect(formatDate(null)).toBe('Unknown date')
    expect(formatDate(undefined)).toBe('Unknown date')
    expect(formatDate('')).toBe('Unknown date')
    expect(formatDate('   ')).toBe('Unknown date')
  })
})

describe('formatStudentYear', () => {
  it('joins year and level with the middle dot', () => {
    expect(formatStudentYear({ school_year: '2025-2026', program_level: 'BSCS' })).toBe('2025-2026 · BSCS')
  })

  it('keeps only the fields that are present', () => {
    expect(formatStudentYear({ school_year: '2025-2026', program_level: null })).toBe('2025-2026')
    expect(formatStudentYear({ school_year: null, program_level: 'JD' })).toBe('JD')
  })

  it('falls back when both fields are null', () => {
    expect(formatStudentYear({ school_year: null, program_level: null })).toBe('No school year')
  })

  it('treats empty strings as absent', () => {
    expect(formatStudentYear({ school_year: '', program_level: '' })).toBe('No school year')
    expect(formatStudentYear({ school_year: '', program_level: 'BSCS' })).toBe('BSCS')
  })
})

describe('formatTimestamp', () => {
  // Freeze "now" in Manila time: 2026-03-05 12:00 noon = 2026-03-05T04:00:00Z
  const NOW_UTC = '2026-03-05T04:00:00Z'

  const freezeNow = () => {
    vi.useFakeTimers({ now: new Date(NOW_UTC) })
  }

  it('labels today with the clock time', () => {
    freezeNow()
    expect(formatTimestamp('2026-03-05T02:30:00Z')).toBe('Today at 10:30 AM')
    expect(formatTimestamp('2026-03-05T04:00:00Z')).toBe('Today at 12:00 PM')
    expect(formatTimestamp('2026-03-04T20:00:00Z')).toBe('Today at 04:00 AM')
  })

  it('labels yesterday', () => {
    freezeNow()
    expect(formatTimestamp('2026-03-04T01:15:00Z')).toBe('Yesterday at 09:15 AM')
  })

  it('rolls the Manila day boundary, not the UTC one', () => {
    freezeNow()
    // 2026-03-03T23:30:00Z is 2026-03-04 07:30 in Manila -> yesterday,
    // even though its UTC date is two days back
    expect(formatTimestamp('2026-03-03T23:30:00Z')).toBe('Yesterday at 07:30 AM')
    // 2026-03-04T20:00:00Z is 2026-03-05 04:00 in Manila -> today,
    // even though its UTC date is yesterday
    expect(formatTimestamp('2026-03-04T20:00:00Z')).toBe('Today at 04:00 AM')
  })

  it('falls back to a dated label for older timestamps', () => {
    freezeNow()
    expect(formatTimestamp('2026-02-20T01:05:00Z')).toBe('Feb 20, 09:05 AM')
    expect(formatTimestamp('2025-11-01T22:00:00Z')).toBe('Nov 2, 06:00 AM')
  })

  it('has no future branch: a timestamp ahead of today is dated, not labelled', () => {
    freezeNow()
    // 2026-03-05T16:30:00Z is 2026-03-06 00:30 in Manila
    expect(formatTimestamp('2026-03-05T16:30:00Z')).toBe('Mar 6, 12:30 AM')
  })

  it('returns the placeholder instead of throwing on an unparseable timestamp', () => {
    // Updated in p1d cp1b: this test used to pin the throwing behaviour (Q12).
    freezeNow()
    expect(formatTimestamp('garbage')).toBe('Unknown time')
    expect(formatTimestamp('2026-13-45T10:00:00Z')).toBe('Unknown time')
  })

  it('returns the placeholder for null, undefined, empty and blank input', () => {
    freezeNow()
    expect(formatTimestamp(null)).toBe('Unknown time')
    expect(formatTimestamp(undefined)).toBe('Unknown time')
    expect(formatTimestamp('')).toBe('Unknown time')
    expect(formatTimestamp('   ')).toBe('Unknown time')
  })

  it('accepts a timestamp that carries a time part', () => {
    freezeNow()
    expect(formatTimestamp('2026-03-05T02:30:00Z')).toBe('Today at 10:30 AM')
    expect(formatTimestamp('2026-03-05T02:30:00.250Z')).toBe('Today at 10:30 AM')
    expect(formatTimestamp('2026-03-04T21:45:00+08:00')).toBe('Yesterday at 09:45 PM')
  })
})
