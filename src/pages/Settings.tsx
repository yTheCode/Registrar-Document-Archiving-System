import { useState, useEffect } from 'react'
import { Folder, Users, FileType, Shield, Plus, Trash2, CheckCircle, XCircle, Download, Upload, Database, Loader2, ArrowUpDown, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/utils/cn'
import PageHeader from '@/components/ui/PageHeader'
import Pagination from '@/components/ui/Pagination'
import { useToast } from '@/components/ui/Toast'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { PageProps, ManagedUser, DocumentType, UserRole } from '@/types'
import { PAGINATION } from '@/constants/pagination'
import { getErrorMessage } from '@/utils/error'

function Settings({ user }: PageProps) {
  // Restrict to admin only
  if (user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-[1420px] p-5 sm:p-7">
        <div className="surface-card rounded-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#fff6df] mb-4">
            <Shield size={28} className="text-[#b17f22]" />
          </div>
          <h2 className="text-lg font-bold text-[#182a43] mb-2">Access Restricted</h2>
          <p className="text-sm text-[#718096]">
            System settings are only available to administrators.
          </p>
        </div>
      </div>
    )
  }

  const [activeTab, setActiveTab] = useState<'general' | 'users' | 'documents' | 'backup'>('general')
  const [message, setMessage] = useState({ type: '', text: '' })
  const [isSaving, setIsSaving] = useState(false)
  const { showError } = useToast()
  
  // General settings
  const [archiveDirectory, setArchiveDirectory] = useState('')
  const [pendingArchiveDir, setPendingArchiveDir] = useState<string | null>(null)
  const [isChangingArchive, setIsChangingArchive] = useState(false)
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false)
  const [integrityResult, setIntegrityResult] = useState<{ total: number; present: number; missing: Array<{ id: number; file_name: string; file_path: string }> } | null>(null)
  
  // Users management
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [usersPage, setUsersPage] = useState(1)
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersSortBy, setUsersSortBy] = useState('username')
  const [usersSortDir, setUsersSortDir] = useState<'asc' | 'desc'>('asc')
  const [showUserModal, setShowUserModal] = useState(false)
  const [newUser, setNewUser] = useState<{ username: string; password: string; role: UserRole }>({ username: '', password: '', role: 'user' })
  const [showPassword, setShowPassword] = useState(false)
  
  // Document types
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([])
  const [showDocTypeModal, setShowDocTypeModal] = useState(false)
  const [newDocTypeName, setNewDocTypeName] = useState('')

  // Backup & Restore
  const [isBackupInProgress, setIsBackupInProgress] = useState(false)
  const [isRestoreInProgress, setIsRestoreInProgress] = useState(false)
  const [lastBackupPath, setLastBackupPath] = useState('')
  // Purge — second confirmation step asks for the administrator password
  const [showPurgeModal, setShowPurgeModal] = useState(false)
  const [purgePassword, setPurgePassword] = useState('')
  const [showPurgePassword, setShowPurgePassword] = useState(false)
  const [purgeError, setPurgeError] = useState('')
  const [isPurging, setIsPurging] = useState(false)
  // Pending action awaiting in-app confirmation
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; danger?: boolean; action: () => void } | null>(null)

  useEffect(() => {
    loadGeneralSettings()
  }, [])

  useEffect(() => {
    if (activeTab === 'users') {
      loadUsers(usersPage)
    } else if (activeTab === 'documents') {
      loadDocumentTypes()
    }
  }, [activeTab, usersPage])

  const loadGeneralSettings = async () => {
    const archiveResult = await window.electronAPI.getSetting('archive_directory')
    if (archiveResult.success && archiveResult.value) {
      setArchiveDirectory(archiveResult.value)
    }
  }

  const handleSelectArchiveDirectory = async () => {
    const result = await window.electronAPI.openDirectoryDialog()
    if (!result.canceled && result.filePaths.length > 0) {
      // Stage the pick; the user chooses Move or Point below before anything changes
      setPendingArchiveDir(result.filePaths[0])
    }
  }

  const confirmArchiveChange = async (mode: 'move' | 'point') => {
    if (!pendingArchiveDir || isChangingArchive) return
    setIsChangingArchive(true)
    try {
      const result = await window.electronAPI.changeArchiveDirectory(pendingArchiveDir, mode, user.id)
      if (result.success) {
        setArchiveDirectory(pendingArchiveDir)
        setMessage({
          type: 'success',
          text: mode === 'move'
            ? `Archive moved — ${result.movedFiles ?? 0} file(s) verified at the new location.`
            : 'Archive directory re-pointed (files left in place).'
        })
        setPendingArchiveDir(null)
      } else {
        showError(result.error || 'Failed to change archive directory')
      }
    } catch (error) {
      console.error('Archive change failed:', error)
      showError('An error occurred while changing the archive directory')
    } finally {
      setIsChangingArchive(false)
      setTimeout(() => setMessage({ type: '', text: '' }), 5000)
    }
  }

  const handleCheckIntegrity = async () => {
    if (isCheckingIntegrity) return
    setIsCheckingIntegrity(true)
    setIntegrityResult(null)
    try {
      const result = await window.electronAPI.checkArchiveIntegrity(user.id)
      if (result.success && result.total !== undefined && result.present !== undefined) {
        setIntegrityResult({ total: result.total, present: result.present, missing: result.missing ?? [] })
      } else {
        showError(result.error || 'Integrity check failed')
      }
    } catch (error) {
      console.error('Integrity check failed:', error)
      showError('An error occurred during the integrity check')
    } finally {
      setIsCheckingIntegrity(false)
    }
  }

  const loadUsers = async (page = usersPage, sortBy = usersSortBy, sortDir = usersSortDir) => {
    const result = await window.electronAPI.getAllUsers(user.id, {
      limit: PAGINATION.USER_PAGE_SIZE,
      offset: (page - 1) * PAGINATION.USER_PAGE_SIZE,
      sortBy,
      sortDir
    })
    if (result.success) {
      setUsers(result.users)
      setUsersTotal(result.total ?? result.users.length)
      setUsersPage(page)
      setUsersSortBy(sortBy)
      setUsersSortDir(sortDir)
    } else {
      console.error('Failed to load users:', result.error)
    }
  }

  const handleUsersSort = (value: string) => {
    if (value === usersSortBy) {
      loadUsers(1, usersSortBy, usersSortDir === 'asc' ? 'desc' : 'asc')
    } else {
      loadUsers(1, value, 'asc')
    }
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSaving) return

    if (!newUser.username || !newUser.password) {
      setMessage({ type: 'error', text: 'Username and password are required' })
      return
    }

    if (newUser.password.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' })
      return
    }

    setIsSaving(true)
    try {
      const result = await window.electronAPI.createUser(newUser.username, newUser.password, newUser.role, user.id)
      if (result.success) {
        setMessage({ type: 'success', text: 'User created successfully!' })
        setShowUserModal(false)
        setNewUser({ username: '', password: '', role: 'user' })
        loadUsers()
        setTimeout(() => setMessage({ type: '', text: '' }), 3000)
      } else {
        showError(result.error || 'Failed to create user')
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleUserStatus = async (userId: number, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active'
    const result = await window.electronAPI.updateUserStatus(userId, newStatus, user.id)
    
    if (result.success) {
      setMessage({ type: 'success', text: `User ${newStatus === 'active' ? 'activated' : 'deactivated'}!` })
      loadUsers()
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
    } else {
      showError(result.error || 'Failed to update user status')
    }
  }

  const handleDeleteUser = (userId: number, username: string) => {
    if (userId === user.id) {
      showError('You cannot delete your own account.')
      return
    }

    setConfirmDialog({
      title: 'Delete User',
      message: `Permanently delete user "${username}"? The account is removed from the database and cannot be restored.`,
      confirmLabel: 'Delete',
      danger: true,
      action: () => executeDeleteUser(userId)
    })
  }

  const executeDeleteUser = async (userId: number) => {
    const result = await window.electronAPI.deleteUser(userId, user.id)
    if (result.success) {
      setMessage({ type: 'success', text: 'User permanently deleted!' })
      setUsers(prev => prev.filter(u => u.id !== userId))
      setUsersTotal(prev => Math.max(0, prev - 1))
      // Step back a page when this row was the only one left on it, otherwise
      // the list would reload an empty page.
      if (users.length === 1 && usersPage > 1) {
        setUsersPage(prev => prev - 1)
      } else {
        loadUsers()
      }
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
    } else {
      showError(result.error || 'Failed to delete user')
    }
  }

  const loadDocumentTypes = async () => {
    const result = await window.electronAPI.getDocumentTypes()
    if (result.success) {
      setDocumentTypes(result.types)
    }
  }

  const handleCreateDocType = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSaving) return

    if (!newDocTypeName) {
      setMessage({ type: 'error', text: 'Document type name is required' })
      return
    }

    setIsSaving(true)
    try {
      const result = await window.electronAPI.createDocumentType(newDocTypeName, user.id)
      if (result.success) {
        setMessage({ type: 'success', text: 'Document type created!' })
        setShowDocTypeModal(false)
        setNewDocTypeName('')
        loadDocumentTypes()
        setTimeout(() => setMessage({ type: '', text: '' }), 3000)
      } else {
        showError(result.error || 'Failed to create document type')
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteDocType = (docTypeId: number, name: string) => {
    setConfirmDialog({
      title: 'Delete Document Type',
      message: `Delete document type "${name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      action: () => executeDeleteDocType(docTypeId)
    })
  }

  const executeDeleteDocType = async (docTypeId: number) => {
    const result = await window.electronAPI.deleteDocumentType(docTypeId, user.id)
    if (result.success) {
      setMessage({ type: 'success', text: 'Document type deleted!' })
      loadDocumentTypes()
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
    } else {
      showError(result.error || 'Failed to delete document type')
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'student': return 'bg-[#dceafb] text-[#24558d]'
      case 'administrative': return 'bg-[#e5f5ee] text-[#2b9b72]'
      case 'financial': return 'bg-[#fff6df] text-[#b17f22]'
      case 'audit': return 'bg-[#f0f3f7] text-[#8793a3]'
      default: return 'bg-[#f0f3f7] text-[#8793a3]'
    }
  }

  // Backup & Restore handlers
  const handleCreateBackup = async () => {
    setIsBackupInProgress(true)
    setMessage({ type: '', text: '' })
    
    try {
      const result = await window.electronAPI.backupCreate(user.id)
      
      if (result.canceled) {
        setIsBackupInProgress(false)
        return
      }
      
      if (result.success) {
        const filePath = result.filePath ?? ''
        setLastBackupPath(filePath)
        const size = `${((result.fileSize ?? 0) / 1024 / 1024).toFixed(2)} MB`
        setMessage({
          type: 'success',
          text: result.warning
            ? `Backup created at ${filePath} (${size}) — ${result.warning}`
            : `Backup created successfully at ${filePath} (${size})`
        })
      } else {
        showError(`Backup failed: ${result.error}`)
      }
    } catch (error) {
      showError(`Backup failed: ${getErrorMessage(error)}`)
    } finally {
      setIsBackupInProgress(false)
    }
  }

  const handleRestoreBackup = () => {
    // First confirmation; its confirm action opens the final confirmation
    setConfirmDialog({
      title: 'Restore Backup',
      message:
        '⚠️ WARNING: Restoring a backup will replace ALL current documents and data.\n\n' +
        'This action CANNOT be undone.\n\n' +
        'Are you absolutely sure you want to continue?',
      confirmLabel: 'Continue',
      danger: true,
      action: () => setConfirmDialog({
        title: 'Final Confirmation',
        message:
          'This will permanently delete all current data and replace it with the backup.\n\n' +
          'Click "Restore" to proceed, or Cancel to abort.',
        confirmLabel: 'Restore',
        danger: true,
        action: () => executeRestoreBackup()
      })
    })
  }

  const executeRestoreBackup = async () => {
    setIsRestoreInProgress(true)
    setMessage({ type: '', text: '' })

    try {
      const result = await window.electronAPI.backupRestore(user.id)

      if (result.canceled) {
        setIsRestoreInProgress(false)
        return
      }

      if (result.success) {
        setMessage({ type: 'success', text: result.message ?? 'Backup restored successfully.' })

        // Offer to close the app so the restored data loads on next launch
        setTimeout(() => {
          setConfirmDialog({
            title: 'Backup Restored',
            message:
              'Backup restored successfully!\n\n' +
              'Screens still show the old data until the application is opened again.\n\n' +
              'Close the application now, then start it again?',
            confirmLabel: 'Close now',
            action: () => window.close()
          })
        }, 1000)
      } else {
        showError(`Restore failed: ${result.error}`)
      }
    } catch (error) {
      showError(`Restore failed: ${getErrorMessage(error)}`)
    } finally {
      setIsRestoreInProgress(false)
    }
  }

  const openPurgeModal = () => {
    setPurgePassword('')
    setPurgeError('')
    setShowPurgePassword(false)
    setShowPurgeModal(true)
  }

  const closePurgeModal = () => {
    if (isPurging) return
    setShowPurgeModal(false)
    setPurgePassword('')
    setPurgeError('')
  }

  // First confirmation: the password. Second confirmation: the danger dialog
  // below. The backend re-checks the password before it deletes anything.
  const handlePurgePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!purgePassword) {
      setPurgeError('Enter your administrator password to continue.')
      return
    }
    setPurgeError('')
    setConfirmDialog({
      title: 'Confirm Permanent Purge',
      message: 'This is the last warning. Every student record, document, archived file and activity log entry will be deleted permanently and cannot be recovered. Continue?',
      confirmLabel: 'Yes, Purge Everything',
      danger: true,
      action: executePurge
    })
  }

  const executePurge = async () => {
    if (isPurging) return
    setIsPurging(true)

    try {
      const result = await window.electronAPI.purgeArchive(user.id, purgePassword)

      if (result.success) {
        setShowPurgeModal(false)
        setPurgePassword('')
        setMessage({
          type: 'success',
          text: `Archive purged. Deleted ${result.deletedStudents ?? 0} students, ${result.deletedDocuments ?? 0} documents, ${result.deletedFiles ?? 0} files and ${result.deletedLogs ?? 0} activity log entries.`
        })
        // Reload data
        loadDocumentTypes()
        if (activeTab === 'users') {
          loadUsers(1)
        }
      } else {
        setPurgeError(result.error || 'Purge failed.')
      }
    } catch (error) {
      setPurgeError(`Purge failed: ${getErrorMessage(error)}`)
    } finally {
      setIsPurging(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1420px] p-5 sm:p-7">
      <PageHeader
        eyebrow="System Configuration"
        title="Settings"
        description="Manage system settings, users, and document types."
      />

      {/* Message Alert */}
      {message.text && (
        <div className={cn(
          'mb-5 rounded-md px-4 py-3 text-xs',
          message.type === 'success' && 'bg-[#e5f5ee] text-[#2b9b72]',
          message.type === 'error' && 'bg-[#fff0ef] text-[#b94843]'
        )}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="surface-card rounded-lg mb-5">
        <div className="flex border-b border-[#e8ebef]">
          <button
            onClick={() => setActiveTab('general')}
            className={cn(
              'flex items-center gap-2 px-5 py-3 text-xs font-bold transition border-b-2',
              activeTab === 'general'
                ? 'border-[#24558d] text-[#24558d]'
                : 'border-transparent text-[#8a95a5] hover:text-[#617084]'
            )}
          >
            <Folder size={14} />
            General
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={cn(
              'flex items-center gap-2 px-5 py-3 text-xs font-bold transition border-b-2',
              activeTab === 'users'
                ? 'border-[#24558d] text-[#24558d]'
                : 'border-transparent text-[#8a95a5] hover:text-[#617084]'
            )}
          >
            <Users size={14} />
            Users
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            className={cn(
              'flex items-center gap-2 px-5 py-3 text-xs font-bold transition border-b-2',
              activeTab === 'documents'
                ? 'border-[#24558d] text-[#24558d]'
                : 'border-transparent text-[#8a95a5] hover:text-[#617084]'
            )}
          >
            <FileType size={14} />
            Document Types
          </button>
          <button
            onClick={() => setActiveTab('backup')}
            className={cn(
              'flex items-center gap-2 px-5 py-3 text-xs font-bold transition border-b-2',
              activeTab === 'backup'
                ? 'border-[#24558d] text-[#24558d]'
                : 'border-transparent text-[#8a95a5] hover:text-[#617084]'
            )}
          >
            <Database size={14} />
            Backup & Restore
          </button>
        </div>
      </div>

      {/* General Settings Tab */}
      {activeTab === 'general' && (
        <div className="space-y-5">
          <div className="surface-card rounded-lg p-5">
            <h3 className="text-sm font-bold text-[#1c2f47] mb-4">Archive Directory</h3>
            <p className="text-xs text-[#8a95a5] mb-4">
              The local folder where all scanned and uploaded documents are stored.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={archiveDirectory}
                readOnly
                className="flex-1 h-10 rounded-md border border-[#d9dfe7] bg-[#f8fafc] px-3 text-sm text-[#617084]"
              />
              <button
                onClick={handleSelectArchiveDirectory}
                disabled={isChangingArchive}
                className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Folder size={14} />
                Change
              </button>
            </div>

            {pendingArchiveDir && (
              <div className="mt-3 rounded-md border border-[#f0e3c0] bg-[#fffaf0] p-3">
                <p className="text-xs font-bold text-[#1c2f47]">Move the archive to this folder?</p>
                <p className="mt-0.5 break-all text-[11px] text-[#8a95a5]">{pendingArchiveDir}</p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => confirmArchiveChange('move')}
                    disabled={isChangingArchive}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isChangingArchive && <Loader2 size={13} className="animate-spin" />}
                    Move files here
                  </button>
                  <button
                    onClick={() => confirmArchiveChange('point')}
                    disabled={isChangingArchive}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-[#d9dfe7] px-3 py-2 text-xs font-bold text-[#4a5568] transition focus-ring hover:bg-[#f5f7fa] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Files are already there
                  </button>
                  <button
                    onClick={() => setPendingArchiveDir(null)}
                    disabled={isChangingArchive}
                    className="rounded-md px-3 py-2 text-xs font-bold text-[#8a95a5] transition hover:bg-[#f5f7fa] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="surface-card rounded-lg p-5">
            <h3 className="text-sm font-bold text-[#1c2f47] mb-1">Archive Integrity</h3>
            <p className="text-xs text-[#8a95a5] mb-4">
              Verify that every document recorded in the database still exists in the archive folder.
            </p>
            <button
              onClick={handleCheckIntegrity}
              disabled={isCheckingIntegrity}
              className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCheckingIntegrity && <Loader2 size={13} className="animate-spin" />}
              Check archive integrity
            </button>

            {integrityResult && (
              <div className="mt-3">
                <p className={`text-xs font-bold ${integrityResult.missing.length > 0 ? 'text-[#c0564f]' : 'text-[#2e7d4f]'}`}>
                  {integrityResult.present} of {integrityResult.total} file{integrityResult.total !== 1 ? 's' : ''} present
                  {integrityResult.missing.length === 0 && ' — archive is intact'}
                </p>
                {integrityResult.missing.length > 0 && (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-[#f0d5d3] bg-[#fdf3f2] p-2">
                    {integrityResult.missing.map((m) => (
                      <li key={m.id} className="text-[11px] text-[#8a4a47]">
                        #{m.id} — {m.file_name} <span className="text-[#b08c8a]">({m.file_path})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="surface-card rounded-lg">
          <div className="flex items-center justify-between border-b border-[#e8ebef] px-5 py-4">
            <div>
              <h3 className="text-sm font-bold text-[#1c2f47]">User Accounts</h3>
              <p className="mt-0.5 text-[11px] text-[#8a95a5]">
                {usersTotal} user{usersTotal !== 1 ? 's' : ''} registered
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <ArrowUpDown size={13} className="text-[#8a95a5]" />
                <select
                  value={usersSortBy}
                  onChange={(e) => handleUsersSort(e.target.value)}
                  className="h-8 rounded-md border border-[#d9dfe7] bg-white px-2 text-xs text-[#47576b] outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                >
                  <option value="username">Username</option>
                  <option value="role">Role</option>
                  <option value="status">Status</option>
                  <option value="created_at">Date Created</option>
                </select>
                <button
                  type="button"
                  onClick={() => loadUsers(1, usersSortBy, usersSortDir === 'asc' ? 'desc' : 'asc')}
                  className="h-8 rounded-md border border-[#d7dde5] bg-white px-2 text-xs font-semibold text-[#34445a] hover:bg-[#f4f6f8] transition"
                  title="Toggle sort direction"
                >
                  {usersSortDir === 'asc' ? 'Asc' : 'Desc'}
                </button>
              </div>
              <button
                onClick={() => setShowUserModal(true)}
                className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778]"
              >
                <Plus size={14} />
                Add User
              </button>
            </div>
          </div>

          <div className="divide-y divide-[#edf0f3]">
            {users.map((u) => {
              const isActive = u.status === 'active'
              return (
                <div
                  key={u.id}
                  className={cn(
                    'px-5 py-4 flex items-center justify-between',
                    !isActive && 'bg-[#fafbfc]'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full bg-[#eaf0f7] text-xs font-bold text-[#315c87]',
                      !isActive && 'opacity-40'
                    )}>
                      {u.username[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[#263950]">
                        {u.username}
                        {u.id === user.id && <span className="ml-2 text-xs text-[#8a95a5]">(You)</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-[#617084]">
                          {u.role === 'admin' ? 'Administrator' : 'Regular Staff'}
                        </span>
                        <span className="text-[#d4d8de]">•</span>
                        <div className="flex items-center gap-1">
                          {isActive ? (
                            <CheckCircle size={12} className="text-[#2b9b72]" />
                          ) : (
                            <XCircle size={12} className="text-[#8793a3]" />
                          )}
                          <span className="text-[10px] text-[#8a95a5]">
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleToggleUserStatus(u.id, u.status)}
                      disabled={u.id === user.id}
                      className="rounded px-3 py-1.5 text-xs font-semibold transition disabled:opacity-30 border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8]"
                    >
                      {isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleDeleteUser(u.id, u.username)}
                      disabled={u.id === user.id}
                      className="rounded p-1.5 text-[#b94843] hover:bg-[#fff0ef] transition disabled:opacity-30"
                      title="Delete user"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="border-t border-[#e8ebef] px-5 py-3">
            <Pagination
              page={usersPage}
              pageSize={PAGINATION.USER_PAGE_SIZE}
              total={usersTotal}
              onPageChange={setUsersPage}
            />
          </div>
        </div>
      )}

      {/* Document Types Tab */}
      {activeTab === 'documents' && (
        <div className="surface-card rounded-lg">
          <div className="flex items-center justify-between border-b border-[#e8ebef] px-5 py-4">
            <div>
              <h3 className="text-sm font-bold text-[#1c2f47]">Document Types</h3>
              <p className="mt-0.5 text-[11px] text-[#8a95a5]">
                {documentTypes.length} document type{documentTypes.length !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={() => setShowDocTypeModal(true)}
              className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778]"
            >
              <Plus size={14} />
              Add Document Type
            </button>
          </div>

          <div className="divide-y divide-[#edf0f3]">
            {documentTypes.map((dt) => (
              <div key={dt.id} className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileType size={18} className="text-[#536d89]" />
                  <div>
                    <div className="text-sm font-bold text-[#263950]">{dt.name}</div>
                    <div className="mt-1">
                      <span className={cn(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                        getCategoryColor(dt.category)
                      )}>
                        {dt.category}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteDocType(dt.id, dt.name)}
                  className="rounded p-1.5 text-[#b94843] hover:bg-[#fff0ef] transition"
                  title="Delete document type"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showUserModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1b2d]/45 p-4 backdrop-blur-[2px]"
          onClick={() => setShowUserModal(false)}
        >
          <div 
            className="slide-in max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#e7eaf0] px-6 py-4">
              <h2 className="text-base font-bold text-[#172a43]">Add New User</h2>
              <button 
                onClick={() => setShowUserModal(false)}
                className="rounded p-1 text-[#8a95a5] hover:bg-[#f1f4f7] hover:text-[#1f2e43]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div>
                <label className="label-caps mb-1.5 block">
                  Username <span className="text-[#b94843]">*</span>
                </label>
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  required
                  className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                />
              </div>

              <div>
                <label className="label-caps mb-1.5 block">
                  Password <span className="text-[#b94843]">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    required
                    minLength={6}
                    className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 pr-10 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8b97a6] hover:text-[#5a6b81] transition"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-[#8a95a5]">Minimum 6 characters</p>
              </div>

              <div>
                <label className="label-caps mb-1.5 block">Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                  className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#47576b] outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                >
                  <option value="user">Regular Staff</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Backup & Restore Tab */}
      {activeTab === 'backup' && (
        <div className="space-y-6">
          {/* Create Backup */}
          <div className="surface-card rounded-lg p-6">
            <h3 className="text-base font-bold text-[#182a43] mb-4">
              Create Backup
            </h3>
            <p className="text-sm text-[#718096] mb-4">
              Create a complete backup of your database and all archived documents. 
              The backup will be saved as a ZIP file that you can restore later.
            </p>
            <button
              onClick={handleCreateBackup}
              disabled={isBackupInProgress}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition focus-ring',
                isBackupInProgress
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-[#24558d] text-white hover:bg-[#1d4778]'
              )}
            >
              {isBackupInProgress ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating Backup...
                </>
              ) : (
                <>
                  <Download size={16} />
                  Create Backup
                </>
              )}
            </button>
            
            {lastBackupPath && (
              <div className="mt-4 p-3 rounded-md bg-[#e5f5ee] border border-[#b3e5d0]">
                <p className="text-xs text-[#2b9b72]">
                  <strong>Last backup created:</strong> {lastBackupPath}
                </p>
              </div>
            )}
          </div>

          {/* Restore from Backup */}
          <div className="surface-card rounded-lg p-6">
            <h3 className="text-base font-bold text-[#182a43] mb-4">
              Restore from Backup
            </h3>
            <div className="p-4 rounded-md bg-[#fff6df] border border-[#f5d99f] mb-4">
              <p className="text-xs text-[#b17f22] font-bold mb-1">
                ⚠️ Warning: This is a destructive operation
              </p>
              <p className="text-xs text-[#8a7248]">
                Restoring a backup will replace ALL current documents and data with the contents of the backup file. 
                This action cannot be undone. Make sure you have a recent backup of your current data before proceeding.
              </p>
            </div>
            <button
              onClick={handleRestoreBackup}
              disabled={isRestoreInProgress}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition focus-ring border-2',
                isRestoreInProgress
                  ? 'border-gray-300 bg-gray-100 text-gray-500 cursor-not-allowed'
                  : 'border-[#d7491d] text-[#d7491d] hover:bg-[#fff0ef]'
              )}
            >
              {isRestoreInProgress ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Restore from Backup
                </>
              )}
            </button>
          </div>

          {/* Purge Archive */}
          <div className="surface-card rounded-lg p-6 border-2 border-[#f5a2a2]">
            <h3 className="text-base font-bold text-[#b94843] mb-4">
              Purge Archive
            </h3>
            <div className="p-4 rounded-md bg-[#fff0ef] border border-[#f5a2a2] mb-4">
              <p className="text-xs text-[#b94843] font-bold mb-1">
                ⚠️ DANGER: This will permanently delete ALL data
              </p>
              <p className="text-xs text-[#8a4a47]">
                This action will permanently delete all students, documents, document types, and activity logs from the database, 
                and remove all files from the archive directory. This operation cannot be undone and is intended for preparing 
                a clean system for final submission. Make sure you have a backup before proceeding.
              </p>
            </div>
            <button
              onClick={openPurgeModal}
              className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition focus-ring bg-[#d7491d] text-white hover:bg-[#b83e18]"
            >
              <Database size={16} />
              Purge Entire Archive
            </button>
          </div>
        </div>
      )}

      {/* Add Document Type Modal */}
      {showDocTypeModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1b2d]/45 p-4 backdrop-blur-[2px]"
          onClick={() => setShowDocTypeModal(false)}
        >
          <div 
            className="slide-in max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#e7eaf0] px-6 py-4">
              <h2 className="text-base font-bold text-[#172a43]">Add Document Type</h2>
              <button 
                onClick={() => setShowDocTypeModal(false)}
                className="rounded p-1 text-[#8a95a5] hover:bg-[#f1f4f7] hover:text-[#1f2e43]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateDocType} className="p-6 space-y-4">
              <div>
                <label className="label-caps mb-1.5 block">
                  Document Type Name <span className="text-[#b94843]">*</span>
                </label>
                <input
                  type="text"
                  value={newDocTypeName}
                  onChange={(e) => setNewDocTypeName(e.target.value)}
                  required
                  placeholder="e.g., Transcript of Records"
                  className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                />
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowDocTypeModal(false)}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Purge Archive — administrator password required before the final confirmation */}
      {showPurgeModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0f1b2d]/45 p-4 backdrop-blur-[2px]"
          onClick={closePurgeModal}
        >
          <div
            className="slide-in w-full max-w-md rounded-lg bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#e7eaf0] px-6 py-4">
              <h2 className="text-base font-bold text-[#b94843]">Purge Entire Archive</h2>
              <button
                onClick={closePurgeModal}
                className="rounded p-1 text-[#8a95a5] hover:bg-[#f1f4f7] hover:text-[#1f2e43]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePurgePasswordSubmit} className="space-y-4 p-6">
              <div className="rounded-md border border-[#f5a2a2] bg-[#fff0ef] p-4">
                <p className="text-xs font-bold text-[#b94843]">
                  This deletes all students, documents, archived files and activity logs.
                </p>
                <p className="mt-1 text-xs text-[#8a4a47]">
                  Confirm with the password of the signed-in administrator account
                  ({user.username}). This operation cannot be undone — make sure you have a backup.
                </p>
              </div>

              <div>
                <label className="label-caps mb-1.5 block" htmlFor="purge-password">
                  Administrator password <span className="text-[#b94843]">*</span>
                </label>
                <div className="relative">
                  <input
                    id="purge-password"
                    type={showPurgePassword ? 'text' : 'password'}
                    value={purgePassword}
                    onChange={(e) => {
                      setPurgePassword(e.target.value)
                      setPurgeError('')
                    }}
                    autoComplete="current-password"
                    disabled={isPurging}
                    className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 pr-10 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPurgePassword(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#8a95a5] hover:bg-[#f1f4f7]"
                    title={showPurgePassword ? 'Hide password' : 'Show password'}
                  >
                    {showPurgePassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {purgeError && (
                <p className="rounded-md bg-[#fff0ef] px-3 py-2 text-xs font-semibold text-[#b94843]">
                  {purgeError}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={closePurgeModal}
                  disabled={isPurging}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8] disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPurging}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring bg-[#b94843] text-white hover:bg-[#a03d39] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPurging ? 'Purging…' : 'Continue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          danger={confirmDialog.danger}
          onConfirm={() => {
            const action = confirmDialog.action
            setConfirmDialog(null)
            action()
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}

export default Settings
