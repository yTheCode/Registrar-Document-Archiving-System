// Typed surface of the preload bridge (`window.electronAPI`).
// The bridge is defined in electron/preload.js; keep the two in sync.
// Result shapes mirror what the ipcMain handlers in electron/main.cjs return.

import type {
  ArchiveDocument,
  DashboardStats,
  DocumentType,
  Log,
  LogInput,
  ManagedUser,
  Student,
  StudentInput,
  User
} from './index'

/** Envelope shared by every IPC handler that can fail. */
export interface IpcResult {
  success: boolean
  error?: string
}

export interface LoginResult extends IpcResult { user: User }
export interface StudentsResult extends IpcResult { students: Student[]; total?: number }
export interface StudentResult extends IpcResult { student: Student }
/** Distinct filter values for the student directory dropdowns (H6). */
export interface StudentFilterOptionsResult extends IpcResult { schoolYears: string[]; programLevels: string[] }
export interface UsersResult extends IpcResult { users: ManagedUser[]; total?: number }
export interface DocumentsResult extends IpcResult { documents: ArchiveDocument[]; total?: number }
export interface DocumentTypesResult extends IpcResult { types: DocumentType[] }
export interface LogsResult extends IpcResult { logs: Log[]; total?: number }
export interface StatsResult extends IpcResult { stats: DashboardStats }
export interface SettingResult extends IpcResult { value: string | null }
export interface IdResult extends IpcResult { id: number }
/** students:create returns possibleDuplicate when a same-name/year/level record exists. */
export interface CreateStudentResult extends IpcResult { id: number; possibleDuplicate?: boolean }
export interface FilePathResult extends IpcResult { filePath: string }
export interface Base64FileResult extends IpcResult { base64: string; mimeType: string }
export interface PrintResult extends IpcResult { external?: boolean }
export interface ExportCopyResult extends IpcResult { canceled?: boolean; filePath?: string }
export interface FolderPathResult extends IpcResult { folderPath: string; fileName: string; destPath: string }
export interface BatchInsertResult extends IpcResult { ids: number[]; count: number }
export interface BackupCreateResult extends IpcResult { canceled?: boolean; filePath?: string; fileSize?: number; warning?: string }
export interface BackupRestoreResult extends IpcResult { canceled?: boolean; message?: string }
export interface ArchiveChangeResult extends IpcResult { mode?: string; movedFiles?: number }
export interface ArchiveIntegrityResult extends IpcResult { total?: number; present?: number; missing?: Array<{ id: number; file_name: string; file_path: string }> }

/** `dialog:showOpenDialog` result (mirrors Electron's DialogResult). */
export interface DialogResult {
  canceled: boolean
  filePaths: string[]
}

export interface OpenFileDialogOptions {
  title?: string
  properties?: string[]
  filters?: Array<{ name: string; extensions: string[] }>
}

/** Filters accepted by `documents:search`. */
export interface DocumentSearchFilters {
  studentName?: string
  studentId?: number
  documentType?: number
  year?: string
  /** Opt-in backend pagination. Omit to receive the full result set. */
  limit?: number
  offset?: number
  /** Whitelisted sort key (created_at | document_type | file_name | student). */
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

/** Opt-in pagination/sorting options shared by the list endpoints. */
export interface PageOpts {
  limit?: number
  offset?: number
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  /** Student directory filters (H6). Ignored by non-student handlers. */
  schoolYear?: string
  programLevel?: string
}

/** Document payload for `documents:createBatch`. */
export interface BatchInsertDocument {
  student_id: number | null
  document_type_id: number
  file_name: string
  file_path: string
  metadata: Record<string, unknown>
}

export interface ElectronAPI {
  // Authentication
  login(credentials: { username: string; password: string }): Promise<LoginResult>

  // Students
  getAllStudents(opts?: PageOpts): Promise<StudentsResult>
  searchStudents(searchTerm: string, opts?: PageOpts): Promise<StudentsResult>
  getStudentById(id: number): Promise<StudentResult>
  createStudent(studentData: StudentInput & { force?: boolean }, userId: number): Promise<CreateStudentResult>
  updateStudent(id: number, studentData: StudentInput, userId: number): Promise<IpcResult>
  deleteStudent(id: number, userId: number): Promise<IpcResult>
  getStudentFilterOptions(): Promise<StudentFilterOptionsResult>
  getDeletedStudents(userId: number, opts?: PageOpts): Promise<StudentsResult>
  restoreStudent(id: number, userId: number): Promise<IpcResult>
  purgeStudent(id: number, userId: number): Promise<IpcResult>

  // Documents
  searchDocuments(filters: DocumentSearchFilters): Promise<DocumentsResult>
  deleteDocument(id: number, userId: number): Promise<IpcResult>
  updateDocument(id: number, userId: number, documentTypeId: number | undefined, studentId: number | null | undefined, academicYear: string | undefined, remarks: string | undefined): Promise<IpcResult & { fileName?: string }>
  getDeletedDocuments(opts: PageOpts & { userId: number }): Promise<DocumentsResult>
  restoreDocument(id: number, userId: number): Promise<IpcResult>
  purgeDocument(id: number, userId: number): Promise<IpcResult & { fileDeleted?: boolean }>

  // Document types
  getDocumentTypes(): Promise<DocumentTypesResult>
  createDocumentType(name: string, userId: number): Promise<IdResult>
  deleteDocumentType(id: number, userId: number): Promise<IpcResult>

  // Settings
  getSetting(key: string): Promise<SettingResult>
  setSetting(key: string, value: string, userId: number): Promise<IpcResult>

  // Native dialogs
  openFileDialog(options?: OpenFileDialogOptions): Promise<DialogResult>
  openDirectoryDialog(): Promise<DialogResult>

  // File operations
  copyFile(sourcePath: string, destPath: string): Promise<FilePathResult>
  openFileExternal(filePath: string): Promise<IpcResult>
  showFileInFolder(filePath: string): Promise<IpcResult>
  readFileAsBase64(filePath: string): Promise<Base64FileResult>
  readPickedFileAsBase64(filePath: string): Promise<Base64FileResult>
  printFile(filePath: string, userId: number): Promise<PrintResult>
  exportFileCopy(filePath: string, userId: number): Promise<ExportCopyResult>

  // Users
  getAllUsers(userId: number, opts?: PageOpts): Promise<UsersResult>
  createUser(username: string, password: string, role: string, createdBy: number): Promise<IdResult>
  updateUserStatus(userId: number, status: string, updatedBy: number): Promise<IpcResult>
  deleteUser(userId: number, deletedBy: number): Promise<IpcResult>

  // Activity logs
  addLog(logData: LogInput): Promise<IpcResult>
  getRecentLogs(limit: number, userId: number, offset?: number, sortBy?: string, sortDir?: 'asc' | 'desc'): Promise<LogsResult>

  // Dashboard
  getDashboardStats(): Promise<StatsResult>

  // Image operations
  saveBase64Image(base64Data: string, fileName: string, destPath: string): Promise<FilePathResult>

  // Batch operations
  createDocumentsBatch(documents: BatchInsertDocument[], userId: number): Promise<BatchInsertResult>

  // Folder path generation
  generateFolderPath(
    studentId: number | null,
    documentTypeId: number,
    documentTypeName: string,
    archiveRoot: string,
    ext: string
  ): Promise<FolderPathResult>

  // Backup & restore
  backupCreate(userId: number): Promise<BackupCreateResult>
  backupRestore(userId: number): Promise<BackupRestoreResult>

  // Archive location
  changeArchiveDirectory(newRoot: string, mode: 'move' | 'point', userId: number): Promise<ArchiveChangeResult>
  checkArchiveIntegrity(userId: number): Promise<ArchiveIntegrityResult>
  /** Requires the administrator password; wipes archive tables and activity logs. */
  purgeArchive(userId: number, password: string): Promise<IpcResult & {
    deletedStudents?: number;
    deletedDocuments?: number;
    deletedFiles?: number;
    deletedLogs?: number;
    message?: string;
  }>

  // Backup & restore
  backupCreate(userId: number): Promise<BackupCreateResult>
  backupRestore(userId: number): Promise<BackupRestoreResult>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
