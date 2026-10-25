// SQL builders shared by the students handlers (and documents:search for
// the free-text filter). Pure: no database handle needed.

/**
 * Build a WHERE fragment for free-text student search, shared by
 * students:search and documents:search. The term is split on whitespace
 * (commas treated as separators) and every word must match (AND) at least one
 * of the student columns (OR). `tableAlias` is the table qualifier ('' for the
 * bare students table, 's' inside the documents join).
 */
function buildStudentSearchFilter(term, tableAlias = '') {
  const words = String(term).replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { clause: '', params: [] };

  const columns = ['first_name', 'middle_name', 'last_name', 'student_id', 'school_year', 'program_level'];
  const clause = words
    .map(() => `(${columns.map(col => `${tableAlias ? tableAlias + '.' : ''}${col} LIKE ?`).join(' OR ')})`)
    .join(' AND ');
  const params = words.flatMap(word => {
    const like = `%${word}%`;
    return columns.map(() => like);
  });
  return { clause, params };
}

// Pagination + sorting are opt-in via `opts`; callers that omit them (e.g. the
// ImportScanner student dropdown, which searches client-side) get every row.
const STUDENT_SORT_COLUMNS = {
  last_name: 'last_name',
  first_name: 'first_name',
  school_year: 'school_year',
  program_level: 'program_level',
  created_at: 'created_at'
};

function buildStudentPage(options = {}) {
  const sortCol = STUDENT_SORT_COLUMNS[options.sortBy] || 'last_name';
  const sortDir = String(options.sortDir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const params = [];
  let tail = ` ORDER BY ${sortCol} ${sortDir}, first_name ASC`;
  if (Number.isFinite(options.limit) && options.limit > 0) {
    tail += ` LIMIT ? OFFSET ?`;
    params.push(Math.max(1, Math.floor(options.limit)), Math.max(0, Math.floor(options.offset || 0)));
  }
  return { tail, params };
}

/**
 * Build the WHERE fragment + params shared by students:getAll and
 * students:search. Soft-deleted rows are excluded unless options.deleted is set
 * (the recycle bin). Optional schoolYear / programLevel narrow the result, and
 * a free-text term is layered on through buildStudentSearchFilter.
 */
function buildStudentListWhere(options = {}, term = null) {
  const clauses = [options.deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const params = [];

  if (term !== null && String(term).trim()) {
    const { clause, params: termParams } = buildStudentSearchFilter(term);
    if (clause) {
      clauses.push(clause);
      params.push(...termParams);
    }
  }
  if (options.schoolYear) {
    clauses.push('school_year = ?');
    params.push(options.schoolYear);
  }
  if (options.programLevel) {
    clauses.push('program_level = ?');
    params.push(options.programLevel);
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

module.exports = { buildStudentSearchFilter, buildStudentPage, buildStudentListWhere };
