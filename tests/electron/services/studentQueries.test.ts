import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

// The module is CommonJS and takes no arguments from electron/db, so it loads
// cleanly in Node. Required through createRequire rather than an ESM import so
// the .cjs stays a plain CJS graph — nothing is patched or stubbed.
const require = createRequire(import.meta.url)
const { buildStudentListWhere, buildStudentSearchFilter } =
  require('../../../electron/services/studentQueries.cjs') as {
    buildStudentSearchFilter: (term: unknown, tableAlias?: string) => { clause: string; params: string[] }
    buildStudentListWhere: (options?: Record<string, unknown>, term?: unknown) => { where: string; params: string[] }
  }

const COLUMNS = ['first_name', 'middle_name', 'last_name', 'student_id', 'school_year', 'program_level']

const group = (alias = '') => `(${COLUMNS.map(c => `${alias ? alias + '.' : ''}${c} LIKE ?`).join(' OR ')})`
const placeholders = (sql: string) => (sql.match(/\?/g) || []).length

describe('buildStudentSearchFilter', () => {
  it('returns an empty clause and no params for an empty or whitespace-only term', () => {
    expect(buildStudentSearchFilter('')).toEqual({ clause: '', params: [] })
    expect(buildStudentSearchFilter('   ')).toEqual({ clause: '', params: [] })
    expect(buildStudentSearchFilter('\t\n  ')).toEqual({ clause: '', params: [] })
  })

  it('searches the literal word "null" when the term is null (String(null) is not skipped)', () => {
    // characterization only: callers pass null to mean "no filter" elsewhere
    expect(buildStudentSearchFilter(null)).toEqual({ clause: group(), params: COLUMNS.map(() => '%null%') })
    expect(buildStudentSearchFilter(undefined)).toEqual({ clause: group(), params: COLUMNS.map(() => '%undefined%') })
  })

  it('builds one OR group over the six student columns for a single name', () => {
    const { clause, params } = buildStudentSearchFilter('juan')
    expect(clause).toBe(group())
    expect(params).toEqual(COLUMNS.map(() => '%juan%'))
    expect(params).toHaveLength(6)
  })

  it('preserves the case the user typed instead of lower-casing', () => {
    const { clause, params } = buildStudentSearchFilter('JUÁN')
    expect(params).toEqual(COLUMNS.map(() => '%JUÁN%'))
    expect(clause).not.toMatch(/LOWER\s*\(/i)
  })

  it('ANDs multiple words and counts six params per word', () => {
    const { clause, params } = buildStudentSearchFilter('juan cruz')
    expect(clause).toBe([group(), group()].join(' AND '))
    expect(params).toEqual([...COLUMNS.map(() => '%juan%'), ...COLUMNS.map(() => '%cruz%')])
    expect(placeholders(clause)).toBe(params.length)
  })

  it('collapses repeated whitespace, including tabs and newlines', () => {
    const { clause, params } = buildStudentSearchFilter('  juan   cruz  ')
    expect(clause.split(' AND ')).toHaveLength(2)
    expect(params).toHaveLength(12)
  })

  it('treats commas as separators, so "Dela Cruz, Juan" becomes three words', () => {
    const { clause, params } = buildStudentSearchFilter('Dela Cruz, Juan')
    expect(clause.split(' AND ')).toHaveLength(3)
    expect(params).toEqual([
      ...COLUMNS.map(() => '%Dela%'),
      ...COLUMNS.map(() => '%Cruz%'),
      ...COLUMNS.map(() => '%Juan%')
    ])
  })

  it('qualifies every column with the table alias', () => {
    expect(buildStudentSearchFilter('juan', 's').clause).toBe(group('s'))
    expect(buildStudentSearchFilter('juan', '').clause).toBe(group())
    expect(buildStudentSearchFilter('juan', undefined).clause).toBe(group())
  })

  it('never changes the clause when the term holds SQL metacharacters', () => {
    const hostile = `O'Brien;--"\\\``
    expect(buildStudentSearchFilter(hostile).clause).toBe(group())
    expect(buildStudentSearchFilter('a*b c/d e:f').clause).toBe([group(), group(), group()].join(' AND '))
  })

  it('keeps the user text out of the SQL string and only in the params', () => {
    // the injection string splits into four words, so it produces four ANDed groups
    const words = [`Robert');`, 'DROP', 'TABLE', 'students;--']
    const { clause, params } = buildStudentSearchFilter(words.join(' '))
    expect(clause).toBe(words.map(() => group()).join(' AND '))
    expect(clause).not.toContain('DROP')
    expect(clause).not.toContain('students')
    expect(clause).not.toContain('Robert')
    expect(clause).not.toContain(`'`)
    expect(clause).toContain('LIKE ?')
    expect(params).toEqual(words.flatMap(word => COLUMNS.map(() => `%${word}%`)))
    expect(params).toHaveLength(words.length * COLUMNS.length)
    expect(placeholders(clause)).toBe(params.length)
  })

  it('does not escape LIKE wildcards, so % and _ stay active in the pattern', () => {
    // characterization only: no ESCAPE clause is emitted, so these widen the match
    const { params, clause } = buildStudentSearchFilter('100%_')
    expect(params).toEqual(COLUMNS.map(() => '%100%_%'))
    expect(clause).not.toMatch(/ESCAPE/i)
  })

  it('leaves a lone quote or semicolon as an ordinary word character', () => {
    expect(buildStudentSearchFilter(';').clause).toBe(group())
    expect(buildStudentSearchFilter("'").params).toEqual(COLUMNS.map(() => `%'%`))
  })
})

describe('buildStudentListWhere', () => {
  it('excludes the recycle bin by default', () => {
    expect(buildStudentListWhere()).toEqual({ where: 'WHERE deleted_at IS NULL', params: [] })
    expect(buildStudentListWhere({})).toEqual({ where: 'WHERE deleted_at IS NULL', params: [] })
  })

  it('flips to only soft-deleted rows when options.deleted is set', () => {
    expect(buildStudentListWhere({ deleted: true })).toEqual({ where: 'WHERE deleted_at IS NOT NULL', params: [] })
  })

  it('ignores an empty, whitespace or null term', () => {
    expect(buildStudentListWhere({}, '')).toEqual({ where: 'WHERE deleted_at IS NULL', params: [] })
    expect(buildStudentListWhere({}, '   ')).toEqual({ where: 'WHERE deleted_at IS NULL', params: [] })
    expect(buildStudentListWhere({}, null)).toEqual({ where: 'WHERE deleted_at IS NULL', params: [] })
  })

  it('treats an undefined term as "no term" via the default parameter', () => {
    // the default `term = null` absorbs undefined, so this wrapper never searches
    // for the literal word "undefined" the way buildStudentSearchFilter does
    expect(buildStudentListWhere({}, undefined)).toEqual({ where: 'WHERE deleted_at IS NULL', params: [] })
  })

  it('appends the free-text group after the deleted check', () => {
    const { where, params } = buildStudentListWhere({}, 'juan')
    expect(where).toBe(`WHERE deleted_at IS NULL AND ${group()}`)
    expect(params).toEqual(COLUMNS.map(() => '%juan%'))
  })

  it('orders schoolYear and programLevel after the term params', () => {
    const { where, params } = buildStudentListWhere(
      { schoolYear: '2025-2026', programLevel: 'BSCS', deleted: true },
      'cruz'
    )
    expect(where).toBe(`WHERE deleted_at IS NOT NULL AND ${group()} AND school_year = ? AND program_level = ?`)
    expect(params).toEqual([...COLUMNS.map(() => '%cruz%'), '2025-2026', 'BSCS'])
    expect(placeholders(where)).toBe(params.length)
  })

  it('skips empty filters but keeps a zero-like text value', () => {
    expect(buildStudentListWhere({ schoolYear: '', programLevel: undefined })).toEqual({
      where: 'WHERE deleted_at IS NULL',
      params: []
    })
    expect(buildStudentListWhere({ schoolYear: '0' }).params).toEqual(['0'])
  })

  it('never uses a table alias, unlike buildStudentSearchFilter', () => {
    expect(buildStudentListWhere({}, 'juan').where).not.toMatch(/\bs\./)
  })

  it('keeps metacharacters out of the SQL string', () => {
    const words = [`a';`, 'DELETE', 'FROM', 'students', 'WHERE', '1=1--']
    const { where, params } = buildStudentListWhere({}, words.join(' '))
    expect(where).not.toContain('DELETE')
    expect(where).not.toContain('students')
    expect(where).not.toContain(`'`)
    expect(where).toBe(`WHERE deleted_at IS NULL AND ${words.map(() => group()).join(' AND ')}`)
    expect(params).toEqual(words.flatMap(word => COLUMNS.map(() => `%${word}%`)))
    expect(placeholders(where)).toBe(params.length)
  })
})
