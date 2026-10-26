const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Authentication
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // Students
  getAllStudents: (opts) => ipcRenderer.invoke('students:getAll', opts),
  searchStudents: (searchTerm, opts) => ipcRenderer.invoke('students:search', searchTerm, opts),
  getStudentById: (id) => ipcRenderer.invoke('students:getById', id),
  createStudent: (studentData, userId) => ipcRenderer.invoke('students:create', studentData, userId),
  updateStudent: (id, studentData, userId) => ipcRenderer.invoke('students:update', { id, studentData, userId }),
  deleteStudent: (id, userId) => ipcRenderer.invoke('students:delete', id, userId),
  getStudentFilterOptions: () => ipcRenderer.invoke('students:getFilterOptions'),
  getDeletedStudents: (userId, opts) => ipcRenderer.invoke('students:getDeleted', userId, opts),
  restoreStudent: (id, userId) => ipcRenderer.invoke('students:restore', id, userId),
  purgeStudent: (id, userId) => ipcRenderer.invoke('students:purge', id, userId),

  // Documents
  searchDocuments: (filters) => ipcRenderer.invoke('documents:search', filters),
  deleteDocument: (id, userId) => ipcRenderer.invoke('documents:delete', { id, userId }),
  updateDocument: (id, userId, documentTypeId, studentId, academicYear, remarks) => ipcRenderer.invoke('documents:update', { id, userId, documentTypeId, studentId, academicYear, remarks }),
  getDeletedDocuments: (opts) => ipcRenderer.invoke('documents:getDeleted', opts),
  restoreDocument: (id, userId) => ipcRenderer.invoke('documents:restore', id, userId),
  purgeDocument: (id, userId) => ipcRenderer.invoke('documents:purge', id, userId),

  // Document Types
  getDocumentTypes: () => ipcRenderer.invoke('documentTypes:getAll'),
  createDocumentType: (name, userId) => ipcRenderer.invoke('documentTypes:create', { name, userId }),
  deleteDocumentType: (id, userId) => ipcRenderer.invoke('documentTypes:delete', { id, userId }),

  // Settings
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value, userId) => ipcRenderer.invoke('settings:set', { key, value, userId }),

  // Dialogs
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),

  // File operations
  copyFile: (sourcePath, destPath) => ipcRenderer.invoke('file:copy', { sourcePath, destPath }),
  openFileExternal: (filePath) => ipcRenderer.invoke('file:openExternal', filePath),
  showFileInFolder: (filePath) => ipcRenderer.invoke('file:showInFolder', filePath),
  readFileAsBase64: (filePath) => ipcRenderer.invoke('file:readAsBase64', filePath),
  readPickedFileAsBase64: (filePath) => ipcRenderer.invoke('file:readPickedAsBase64', filePath),
  printFile: (filePath, userId) => ipcRenderer.invoke('file:print', { filePath, userId }),
  exportFileCopy: (filePath, userId) => ipcRenderer.invoke('file:exportCopy', { filePath, userId }),

  // Users
  getAllUsers: (userId, opts) => ipcRenderer.invoke('users:getAll', userId, opts),
  createUser: (username, password, role, createdBy) => ipcRenderer.invoke('users:create', { username, password, role, createdBy }),
  updateUserStatus: (userId, status, updatedBy) => ipcRenderer.invoke('users:updateStatus', { userId, status, updatedBy }),
  deleteUser: (userId, deletedBy) => ipcRenderer.invoke('users:delete', { userId, deletedBy }),

  // Activity Logs
  addLog: (logData) => ipcRenderer.invoke('logs:add', logData),
  getRecentLogs: (limit, userId, offset, sortBy, sortDir) => ipcRenderer.invoke('logs:getRecent', limit, userId, offset, sortBy, sortDir),

  // Dashboard
  getDashboardStats: () => ipcRenderer.invoke('dashboard:getStats'),

  // Image Operations
  saveBase64Image: (base64Data, fileName, destPath) => ipcRenderer.invoke('image:saveBase64', { base64Data, fileName, destPath }),

  // Batch Operations
  createDocumentsBatch: (documents, userId) => ipcRenderer.invoke('documents:createBatch', { documents, userId }),

  // Folder Path Generation
  generateFolderPath: (studentId, documentTypeId, documentTypeName, archiveRoot, ext) => ipcRenderer.invoke('folders:generatePath', { studentId, documentTypeId, documentTypeName, archiveRoot, ext }),

  // Backup & Restore
  backupCreate: (userId) => ipcRenderer.invoke('backup:create', userId),
  backupRestore: (userId) => ipcRenderer.invoke('backup:restore', userId),

  // Archive location
  changeArchiveDirectory: (newRoot, mode, userId) => ipcRenderer.invoke('archive:changeDirectory', { newRoot, mode, userId }),
  checkArchiveIntegrity: (userId) => ipcRenderer.invoke('archive:checkIntegrity', { userId }),
  purgeArchive: (userId, password) => ipcRenderer.invoke('archive:purgeAll', { userId, password })
});
