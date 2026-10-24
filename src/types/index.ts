// Shared domain types for the renderer.
// Previously each component redeclared these (7 copies of `declare global`,
// three variations of `Student`, etc.) — definitions now live in this one place.

export type UserRole = 'admin' | 'user'

/** Authenticated session user (returned by `auth:login`, cached in sessionStorage). */
export interface User {
  id: number
  username: string
  role: UserRole
}

/** Account row shown in Settings → Users (admin-only management list).
 * Accounts are hard-deleted, so there is no soft-delete state to carry. */
export interface ManagedUser {
  id: number
  username: string
  role: UserRole
  status: string
  created_at: string
  updated_at: string
}

/** Standard props accepted by every routed page component. */
export interface PageProps {
  user: User
}

/** Student record as stored in the `students` table. */
export interface Student {
  id: number
  student_id: string | null
  first_name: string
  last_name: string
  middle_name: string | null
  school_year: string | null
  program_level: string | null
  created_at: string
  /** Set when the record is soft-deleted into the recycle bin (H3). */
  deleted_at?: string | null
}

/** Payload sent when creating or updating a student. */
export interface StudentInput {
  student_id: string
  first_name: string
  last_name: string
  middle_name: string
  school_year: string
  program_level: string
}

/**
 * Row returned by `documents:search`: a document joined with its student.
 * Student fields are null for general (student-less) documents.
 */
export interface ArchiveDocument {
  id: number
  document_type: string
  document_type_id: number
  file_name: string
  file_path: string
  created_at: string
  /** Name of the account that archived the file, kept on the row so it
   * survives that account being hard-deleted. */
  created_by_name: string
  metadata_json: string | null
  /** Foreign key to `students`; null for general (student-less) documents. */
  student_id: number | null
  /** The student's own ID string, which is optional in the students table. */
  student_number: string | null
  first_name: string | null
  last_name: string | null
  middle_name: string | null
  school_year: string | null
  program_level: string | null
  /** Set when the document is soft-deleted into the recycle bin. */
  deleted_at?: string | null
}

/** Dashboard stats. `recentDocuments` rows are complete `ArchiveDocument`s
 *  (same columns as documents:search) so they can open in DocumentViewerModal. */
export interface DashboardStats {
  totalStudents: number
  totalDocuments: number
  recentDocuments: ArchiveDocument[]
}

export interface DocumentType {
  id: number
  name: string
  category: string
}

/** Activity-log row (joined with the acting user's name). */
export interface Log {
  id: number
  user_id: number
  username: string
  action: string
  target_type: string | null
  target_id: number | null
  details: string | null
  created_at: string
}

export interface LogInput {
  userId: number
  action: string
  targetType?: string
  targetId?: number
  details?: string
}

// ---------- Import workflow (used by the ImportScanner page) ----------

export type Workflow = 'single-student-upload' | 'single-student-scan' | 'mixed-batch-upload' | 'mixed-batch-scan'

/** A file staged for import, plus the metadata collected for it. */
export interface FileWithMetadata {
  tempId: string
  file: File
  filePath: string
  student: Student | null
  documentTypeId: string
  academicYear: string
  remarks: string
  dynamicMetadata: Record<string, string>
  isDataUrl?: boolean
  editedDataUrl?: string
  thumbnail?: string
}

/** Per-file outcome of a batch import. */
export interface BatchResult {
  filePath: string
  success: boolean
  error?: string
}
