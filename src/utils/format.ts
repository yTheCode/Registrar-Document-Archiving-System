export function formatDate(dateString: string) {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date)
}

/** School year (+ program level) — the required identifier shown in place of the optional student ID. */
export function formatStudentYear(student: { school_year: string | null; program_level: string | null }) {
  return [student.school_year, student.program_level].filter(Boolean).join(' · ') || 'No school year'
}

const MANILA_TZ = 'Asia/Manila'

export function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp)
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  const dayKey = (d: Date) => dayFmt.format(d)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  const timeStr = date.toLocaleTimeString('en-US', {
    timeZone: MANILA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })

  if (dayKey(date) === dayKey(now)) {
    return `Today at ${timeStr}`
  }
  if (dayKey(date) === dayKey(yesterday)) {
    return `Yesterday at ${timeStr}`
  }
  return date.toLocaleString('en-US', {
    timeZone: MANILA_TZ,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
}
