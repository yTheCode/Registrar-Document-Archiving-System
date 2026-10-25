import { useState, useEffect, useMemo, useRef } from 'react'
import { Camera, FileText, AlertCircle } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatStudentYear } from '@/utils/format'
import ConfirmDialog from '@/components/ConfirmDialog'
import PageHeader from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { detectPaperQuad, extractPaperDataUrl, initScanner } from '@/utils/jscanifyScanner'
import { applyCameraQuality, cameraQualityKey, formatResolution, listCameraQualities, readTrackResolution } from '@/utils/cameraCapabilities'
import type { CameraQuality } from '@/utils/cameraCapabilities'
import { debounce } from '@/utils/debounce'
import { getErrorMessage } from '@/utils/error'
import { IMAGE_QUALITY } from '@/constants/image'
import { CAMERA_RESOLUTION_PRESETS, SCANNER_CONFIG } from '@/constants/scanner'
import { PAGINATION } from '@/constants/pagination'
import type {
  PageProps,
  Student,
  DocumentType,
  FileWithMetadata,
  BatchResult,
  Workflow
} from '@/types'
import { validateDocument, isFileReady } from '@/features/import-scanner/lib/documentValidation'
import { isEditableImage } from '@/features/import-scanner/lib/editableImages'
import { getReviewWindow } from '@/features/import-scanner/lib/queueHelpers'
import { filterStudents, studentIdFromSearchTerm } from '@/features/import-scanner/lib/studentSearch'
import { describeCameraError } from '@/features/import-scanner/lib/cameraErrors'
import { drawLiveOutline } from '@/features/import-scanner/lib/liveOutline'
import AccessRestricted from '@/features/import-scanner/components/AccessRestricted'
import AddStudentModal from '@/features/import-scanner/components/AddStudentModal'
import BatchResultsList from '@/features/import-scanner/components/BatchResultsList'
import DocumentStudentField from '@/features/import-scanner/components/DocumentStudentField'
import ImageEditorModal from '@/features/import-scanner/components/ImageEditorModal'
import ImportActionBar from '@/features/import-scanner/components/ImportActionBar'
import ReviewTable from '@/features/import-scanner/components/ReviewTable'
import SavingOverlay from '@/features/import-scanner/components/SavingOverlay'
import ScannedQueue from '@/features/import-scanner/components/ScannedQueue'
import SessionStudentPicker from '@/features/import-scanner/components/SessionStudentPicker'
import StepFileAcquisition from '@/features/import-scanner/components/StepFileAcquisition'
import WorkflowBanner from '@/features/import-scanner/components/WorkflowBanner'
import WorkflowPicker from '@/features/import-scanner/components/WorkflowPicker'


function ImportScanner({ user }: PageProps) {
  // Restrict to admin only
  if (user.role !== 'admin') {
    return <AccessRestricted />
  }

  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [step, setStep] = useState<'mode' | 'selectStudent' | 'files' | 'camera' | 'details'>('mode')
  const [message, setMessage] = useState({ type: '', text: '' })
  const { showError } = useToast()

  // Pending action awaiting in-app confirmation
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; danger?: boolean; action: () => void } | null>(null)

  // Batch student (Student Upload / Student Scan workflows)
  const [batchStudent, setBatchStudent] = useState<Student | null>(null)

  // Batch file data with individual metadata
  const [filesWithMetadata, setFilesWithMetadata] = useState<FileWithMetadata[]>([])
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [reviewPage, setReviewPage] = useState(1)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [showImageEditor, setShowImageEditor] = useState(false)
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null)
  // Which scanned document the open editor belongs to, so accepting a result
  // updates exactly that capture
  const editorTargetRef = useRef<number | null>(null)
  // Sequential editing: queue of image indices to edit
  const [editAllImagesMode, setEditAllImagesMode] = useState(false)
  const editQueueRef = useRef<number[]>([])

  // Camera state
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  // Mirrors cameraStream for cleanup paths that must see the live stream
  // instead of the stream captured by the first render's closure.
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState('')
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  // Quality options are read from the live track's capabilities, so they differ
  // per device (built-in webcam vs. CZUR Shine) and default to its highest mode.
  const [qualityOptions, setQualityOptions] = useState<CameraQuality[]>([])
  const [selectedQuality, setSelectedQuality] = useState('')
  const [activeResolution, setActiveResolution] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraActiveRef = useRef(false)
  // Resolution asked of the next stream; cleared when the camera changes so the
  // new device falls back to its own native maximum.
  const qualityPrefRef = useRef<{ width: number; height: number } | null>(null)
  const nextTempIdRef = useRef(1)
  const newTempId = () => `doc-${nextTempIdRef.current++}`

  // Live jscanify detection over the preview
  const [scannerState, setScannerState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [documentFound, setDocumentFound] = useState(false)
  // Edges were found but not trusted enough to crop automatically; the editor
  // will show them as corners for the user to confirm.
  const [edgesUncertain, setEdgesUncertain] = useState(false)
  // Master switch for the edge-detection / auto-crop feature. When off, the
  // camera captures plain frames and imported images are queued untouched.
  const [autoCropEnabled, setAutoCropEnabled] = useState(true)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const detectionBusyRef = useRef(false)

  // Metadata options
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [searchTerm, setSearchTerm] = useState('')

  // Add New Student during import — opened from a student search with no matches
  const pendingStudentPickRef = useRef<((s: Student) => void) | null>(null)
  const [showAddStudentForm, setShowAddStudentForm] = useState(false)
  const [newStudentForm, setNewStudentForm] = useState({ student_id: '', first_name: '', last_name: '', middle_name: '', school_year: '', program_level: '' })
  // Set when the server flags a possible duplicate; the next submit bypasses
  // that check only if the user confirms "Add anyway?"
  const [pendingForceAdd, setPendingForceAdd] = useState(false)
  const [addStudentMessage, setAddStudentMessage] = useState({ type: '', text: '' })
  const [isAddingStudent, setIsAddingStudent] = useState(false)

  // Current file metadata (for the file being edited)
  const [currentStudent, setCurrentStudent] = useState<Student | null>(null)
  const [currentDocType, setCurrentDocType] = useState('')
  const [currentAcademicYear, setCurrentAcademicYear] = useState('')
  const [currentRemarks, setCurrentRemarks] = useState('')
  const [currentDynamic, setCurrentDynamic] = useState<Record<string, string>>({})

  const [isProcessing, setIsProcessing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [batchResults, setBatchResults] = useState<BatchResult[]>([])

  useEffect(() => {
    loadDocumentTypes()
    loadStudents()
  }, [])

  const loadDocumentTypes = async () => {
    const result = await window.electronAPI.getDocumentTypes()
    if (result.success) {
      setDocumentTypes(result.types)
    }
  }

  const loadStudents = async () => {
    const result = await window.electronAPI.getAllStudents()
    if (result.success) {
      setStudents(result.students)
    }
  }

  // Per-document student pick (general workflows) — shared by the match list and
  // the Add New Student flow so creation continues the import automatically
  const handlePickCurrentStudent = (s: Student) => {
    setCurrentStudent(s)
    setSearchTerm('')
  }

  const openAddStudentForm = (onPick: (s: Student) => void) => {
    pendingStudentPickRef.current = onPick
    setNewStudentForm({
      student_id: studentIdFromSearchTerm(searchTerm),
      first_name: '',
      last_name: '',
      middle_name: '',
      school_year: '',
      program_level: ''
    })
    setAddStudentMessage({ type: '', text: '' })
    setShowAddStudentForm(true)
  }

  const closeAddStudentForm = () => {
    pendingStudentPickRef.current = null
    setShowAddStudentForm(false)
    setAddStudentMessage({ type: '', text: '' })
    setPendingForceAdd(false)
  }

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isAddingStudent) return
    setAddStudentMessage({ type: '', text: '' })

    if (!newStudentForm.first_name.trim() || !newStudentForm.last_name.trim()) {
      setAddStudentMessage({ type: 'error', text: 'First Name and Last Name are required' })
      return
    }
    if (!newStudentForm.school_year.trim()) {
      setAddStudentMessage({ type: 'error', text: 'School Year is required (e.g., 1996-1997)' })
      return
    }
    if (!newStudentForm.program_level) {
      setAddStudentMessage({ type: 'error', text: 'Program Level is required' })
      return
    }

    setIsAddingStudent(true)
    try {
      const payload = pendingForceAdd ? { ...newStudentForm, force: true } : newStudentForm
      const result = await window.electronAPI.createStudent(payload, user.id)
      if (!result.success) {
        if (result.possibleDuplicate) {
          setPendingForceAdd(true)
        } else {
          setPendingForceAdd(false)
        }
        setAddStudentMessage({ type: 'error', text: result.error || 'Failed to add student' })
        return
      }

      const fresh = await window.electronAPI.getStudentById(result.id)
      const student: Student = fresh.success && fresh.student
        ? fresh.student
        : {
            id: result.id,
            student_id: newStudentForm.student_id,
            first_name: newStudentForm.first_name,
            last_name: newStudentForm.last_name,
            middle_name: newStudentForm.middle_name || null,
            school_year: newStudentForm.school_year,
            program_level: newStudentForm.program_level,
            created_at: new Date().toISOString()
          }

      setStudents(prev => [...prev, student])
      await window.electronAPI.addLog({
        userId: user.id,
        action: 'student_created',
        targetType: 'student',
        targetId: student.id,
        details: `${student.first_name} ${student.last_name}`
      })

      // Continue the original import flow with the new student — no restart needed
      const onPick = pendingStudentPickRef.current
      closeAddStudentForm()
      setSearchTerm('')
      onPick?.(student)
    } catch (error) {
      setAddStudentMessage({ type: 'error', text: `An error occurred: ${getErrorMessage(error)}` })
    } finally {
      setIsAddingStudent(false)
    }
  }

  // Warn before closing the window with an unsaved scan/upload batch
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (filesWithMetadata.length > 0 && step !== 'details') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [filesWithMetadata.length, step])

  const isStudentWorkflow = workflow === 'single-student-upload' || workflow === 'single-student-scan'
  const isScanWorkflow = workflow === 'single-student-scan' || workflow === 'mixed-batch-scan'

  // Keep the review table page in sync with the active document.
  useEffect(() => {
    setReviewPage(Math.floor(currentFileIndex / PAGINATION.REVIEW_PAGE_SIZE) + 1)
  }, [currentFileIndex])

  const { start: reviewStart, slice: reviewSlice } = getReviewWindow(filesWithMetadata, reviewPage)

  const currentFile = filesWithMetadata[currentFileIndex]
  const studentRequiredForCurrent = true // All documents now require a student

  const readyCount = filesWithMetadata.filter(f => isFileReady(f, documentTypes)).length

  const editableImageCount = filesWithMetadata.filter(isEditableImage).length

  const debouncedUpdate = useMemo(
    () => debounce((updates: Partial<FileWithMetadata>) => {
      setFilesWithMetadata(prev => prev.map((f, i) =>
        i === currentFileIndex ? { ...f, ...updates } : f
      ))
    }, 300),
    [currentFileIndex]
  )

  useEffect(() => {
    return () => {
      debouncedUpdate.cancel()
    }
  }, [debouncedUpdate])

  // LIVE SYNC: write the active document's in-progress form fields back into
  // filesWithMetadata so its readiness/status recalculates. Debounced so
  // rapid typing does not rewrite the whole queue on every keystroke.
  useEffect(() => {
    if (step !== 'details') return
    const file = filesWithMetadata[currentFileIndex]
    if (!file) return
    const student = isStudentWorkflow ? batchStudent : currentStudent

    if (file.documentTypeId !== currentDocType ||
        file.academicYear !== currentAcademicYear ||
        file.remarks !== currentRemarks ||
        file.student !== student ||
        JSON.stringify(file.dynamicMetadata || {}) !== JSON.stringify(currentDynamic)) {
      debouncedUpdate({
        student,
        documentTypeId: currentDocType,
        academicYear: currentAcademicYear,
        remarks: currentRemarks,
        dynamicMetadata: { ...currentDynamic }
      })
    }
  }, [currentDocType, currentAcademicYear, currentRemarks, currentDynamic, currentStudent, currentFileIndex, batchStudent, isStudentWorkflow, step, debouncedUpdate])

  const handleFileSelect = async () => {
    const result = await window.electronAPI.openFileDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx', 'xls', 'xlsx'] }
      ]
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const newFiles: FileWithMetadata[] = result.filePaths.map((filePath: string) => {
        const fileName = filePath.split(/[\\/]/).pop() || 'file'
        return {
          tempId: newTempId(),
          file: new File([], fileName, { type: 'application/octet-stream' }),
          filePath,
          student: isStudentWorkflow ? batchStudent : null,
          documentTypeId: '',
          academicYear: '',
          remarks: '',
          dynamicMetadata: {}
        }
      })

      // Append to any existing batch instead of replacing it, so a second disk
      // import never discards files that are already queued.
      const firstNewIndex = filesWithMetadata.length
      setFilesWithMetadata(prev => [...prev, ...newFiles])
      setCurrentFileIndex(firstNewIndex)
      setCurrentStudent(isStudentWorkflow ? batchStudent : null)
      setCurrentDocType('')
      setCurrentAcademicYear('')
      setCurrentRemarks('')
      setCurrentDynamic({})
      setSearchTerm('')
      setStep('details')
    }
  }

  // Input labels only appear once permission has been granted, so enumeration
  // runs when the camera screen opens (IDs) and again after a stream starts.
  const refreshVideoDevices = async (): Promise<MediaDeviceInfo[]> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoInputs = devices.filter(device => device.kind === 'videoinput')
      setVideoDevices(videoInputs)
      return videoInputs
    } catch (error) {
      console.warn('Camera enumeration failed:', error)
      return []
    }
  }

  // Scanner drivers such as the CZUR Shine refuse high resolution targets
  // outright, so an unsized request is the safety net that keeps the feed alive.
  const openCameraStream = async (
    device: MediaTrackConstraints,
    ideal: { width: number; height: number }
  ): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { ...device, width: { ideal: ideal.width }, height: { ideal: ideal.height } }
      })
    } catch (error) {
      console.warn('Sized camera request failed, retrying without resolution constraints:', error)
      return navigator.mediaDevices.getUserMedia({ video: device })
    }
  }

  const rememberQuality = (quality: CameraQuality) => {
    setSelectedQuality(cameraQualityKey(quality))
    qualityPrefRef.current = { width: quality.width, height: quality.height }
  }

  /** Show the mode the hardware actually runs, and select it when it matches an option. */
  const showLiveResolution = (track: MediaStreamTrack, qualities: CameraQuality[]) => {
    const live = readTrackResolution(track)
    setActiveResolution(formatResolution(live.width, live.height))
    const matched = qualities.find(q => q.width === live.width && q.height === live.height)
    if (matched) rememberQuality(matched)
    return live
  }

  const startCamera = async (targetDeviceId?: string) => {
    setCameraError('')
    cameraActiveRef.current = true
    const preferred = qualityPrefRef.current
    try {
      const device: MediaTrackConstraints = targetDeviceId
        ? { deviceId: { exact: targetDeviceId } }
        : { facingMode: 'environment' }
      const ideal = preferred ?? {
        width: CAMERA_RESOLUTION_PRESETS[0].width,
        height: CAMERA_RESOLUTION_PRESETS[0].height
      }
      const stream = await openCameraStream(device, ideal)
      if (!cameraActiveRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      cameraStreamRef.current = stream
      setCameraStream(stream)

      // Wait for video element to be ready
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      }, 100)

      const videoInputs = await refreshVideoDevices()
      const track = stream.getVideoTracks()[0]
      // Reading settings must never take a working feed down with it.
      let activeId: string | undefined
      try {
        activeId = track?.getSettings().deviceId
      } catch {
        activeId = undefined
      }
      if (activeId) setDeviceId(activeId)
      else if (!targetDeviceId && videoInputs.length > 0) setDeviceId(videoInputs[0].deviceId)

      if (!track || !cameraActiveRef.current) return

      // Build the quality list from what this camera reports and settle on the
      // requested mode, falling back to its native maximum.
      const qualities = listCameraQualities(track)
      setQualityOptions(qualities)
      const requested =
        qualities.find(q => q.width === preferred?.width && q.height === preferred?.height) ?? qualities[0]
      if (!requested) return

      rememberQuality(requested)
      try {
        await applyCameraQuality(track, requested)
      } catch (error) {
        console.warn('Quality request rejected:', error)
        setCameraError(`${requested.label} is not available on this camera (${getErrorMessage(error)}). Choose a lower quality.`)
      }
      if (!cameraActiveRef.current) return
      showLiveResolution(track, qualities)
    } catch (error) {
      console.error('Camera access error:', error)
      setCameraError(describeCameraError(error))
      setMessage({ type: 'error', text: 'Camera access failed. See error message below.' })
    }
  }

  const handleStartScan = () => {
    setCameraError('')
    setRetakeIndex(null)
    setStep('camera')
    startCamera(deviceId || undefined)
  }

  /**
   * Release the camera hardware: every track of the live stream is stopped, so
   * the indicator light goes out as soon as a capture is taken, the view is
   * left, or the page unmounts. Reads the stream from a ref so it also works
   * from the unmount cleanup, where state is stale.
   */
  const stopCamera = () => {
    cameraActiveRef.current = false
    setDocumentFound(false)
    setEdgesUncertain(false)
    setActiveResolution('')
    const stream = cameraStreamRef.current
    cameraStreamRef.current = null
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
    }
    setCameraStream(null)
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  const handleSwitchCamera = (newDeviceId: string) => {
    // A different device has a different capability set: forget the current
    // quality so the new camera starts at its own native maximum.
    qualityPrefRef.current = null
    setQualityOptions([])
    setSelectedQuality('')
    setDeviceId(newDeviceId)
    stopCamera()
    startCamera(newDeviceId)
  }

  const handleQualityChange = async (key: string) => {
    const option = qualityOptions.find(q => cameraQualityKey(q) === key)
    const track = cameraStream?.getVideoTracks()[0]
    if (!option || !track) return

    rememberQuality(option)
    setCameraError('')
    try {
      await applyCameraQuality(track, option)
    } catch (error) {
      console.warn('Quality change rejected:', error)
      setCameraError(`${option.label} was refused by this camera (${getErrorMessage(error)}). Choose a lower quality.`)
      return
    }

    const live = showLiveResolution(track, qualityOptions)
    if (!live.width || !live.height) return
    setMessage(
      live.width === option.width && live.height === option.height
        ? { type: 'success', text: `Capture quality set to ${option.label}.` }
        : { type: 'error', text: `${formatResolution(live.width, live.height)} is the closest mode this camera offers to ${option.width} × ${option.height}.` }
    )
    setTimeout(() => setMessage({ type: '', text: '' }), 3500)
  }

  const handleToggleAutoCrop = () => {
    setAutoCropEnabled(prev => {
      const next = !prev
      setMessage({
        type: 'success',
        text: next
          ? 'Auto-crop scanning is ON — captures and imports are straightened automatically.'
          : 'Auto-crop scanning is OFF — the camera captures plain frames and imports are kept as-is.'
      })
      return next
    })
  }

  // List inputs as soon as the camera screen opens, and again when hardware is
  // hot-plugged — document scanners are usually connected after the app starts.
  useEffect(() => {
    if (step !== 'camera') return
    void refreshVideoDevices()
    const media = navigator.mediaDevices
    if (!media || typeof media.addEventListener !== 'function') return
    const onDevicesChanged = () => { void refreshVideoDevices() }
    media.addEventListener('devicechange', onDevicesChanged)
    return () => media.removeEventListener('devicechange', onDevicesChanged)
  }, [step])

  // Load OpenCV.js + jscanify once when the camera step opens (local assets, no network)
  useEffect(() => {
    if (step !== 'camera') {
      setDocumentFound(false)
      setEdgesUncertain(false)
      return
    }
    let cancelled = false
    setScannerState('loading')
    initScanner()
      .then(() => {
        if (!cancelled) setScannerState('ready')
      })
      .catch(error => {
        console.error('Scanner initialisation failed:', error)
        if (!cancelled) setScannerState('failed')
      })
    return () => { cancelled = true }
  }, [step])

  // Continuous detection over the live preview; paused while the editor is open
  useEffect(() => {
    if (step !== 'camera' || !cameraStream || showImageEditor || scannerState !== 'ready' || !autoCropEnabled) return
    const id = window.setInterval(() => runLiveDetection(), SCANNER_CONFIG.LIVE_DETECT_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [step, cameraStream, showImageEditor, scannerState, autoCropEnabled])

  // Turning auto-crop off clears the live outline and the "document found" flag
  useEffect(() => {
    if (autoCropEnabled) return
    setDocumentFound(false)
    setEdgesUncertain(false)
    const overlay = overlayCanvasRef.current
    const ctx = overlay?.getContext('2d')
    if (overlay && ctx) ctx.clearRect(0, 0, overlay.width, overlay.height)
  }, [autoCropEnabled])

  const runLiveDetection = () => {
    if (detectionBusyRef.current) return
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return

    detectionBusyRef.current = true
    try {
      const scale = Math.min(1, SCANNER_CONFIG.LIVE_ANALYSIS_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight))
      const width = Math.max(16, Math.round(video.videoWidth * scale))
      const height = Math.max(16, Math.round(video.videoHeight * scale))

      let scratch = analysisCanvasRef.current
      if (!scratch) {
        scratch = document.createElement('canvas')
        analysisCanvasRef.current = scratch
      }
      scratch.width = width
      scratch.height = height
      const ctx = scratch.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(video, 0, 0, width, height)

      const quad = detectPaperQuad(scratch)
      drawLiveOutline(overlayCanvasRef.current, videoRef.current, quad, width)
      setDocumentFound(Boolean(quad?.confident))
      setEdgesUncertain(quad !== null && !quad.confident)
    } catch (error) {
      console.error('Live detection failed:', error)
      setScannerState('failed')
      setDocumentFound(false)
      setEdgesUncertain(false)
    } finally {
      detectionBusyRef.current = false
    }
  }

  /**
   * Capture a frame and add it to the batch. With auto-crop on, a confidently
   * detected page is cropped and straightened at capture; otherwise the frame is
   * added exactly as framed. Cropping can always be redone through the Edit
   * action. The stream stays live so the next page can be scanned without
   * re-opening the camera; it is released when leaving this step.
   */
  const handleCapturePhoto = () => {
    const video = videoRef.current
    if (!video) return
    if (!video.videoWidth || !video.videoHeight) {
      setMessage({ type: 'error', text: 'The camera preview is not ready yet. Wait a moment, then capture again.' })
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    let imageDataUrl = canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
    let croppedPage = false
    if (autoCropEnabled && scannerState === 'ready') {
      // A failed detection must never cost the user the capture, so the full
      // frame stands whenever nothing usable comes back.
      try {
        const detected = detectPaperQuad(canvas, { maxSide: SCANNER_CONFIG.LIVE_ANALYSIS_MAX_SIDE })
        if (detected && detected.confident) {
          const extracted = extractPaperDataUrl(canvas, detected)
          if (extracted) {
            imageDataUrl = extracted
            croppedPage = true
          }
        }
      } catch (error) {
        console.error('Capture-time page detection failed:', error)
      }
    }
    const fileName = `captured_${Date.now()}.jpg`

    const wasRetake = retakeIndex !== null
    let updated: FileWithMetadata[]
    if (wasRetake && retakeIndex !== null) {
      updated = [...filesWithMetadata]
      const old = updated[retakeIndex]
      updated[retakeIndex] = {
        ...old,
        file: new File([], fileName, { type: 'image/jpeg' }),
        filePath: imageDataUrl,
        isDataUrl: true,
        editedDataUrl: undefined,
        thumbnail: imageDataUrl
      }
      setRetakeIndex(null)
    } else {
      const newFile: FileWithMetadata = {
        tempId: newTempId(),
        file: new File([], fileName, { type: 'image/jpeg' }),
        filePath: imageDataUrl,
        isDataUrl: true,
        student: isStudentWorkflow ? batchStudent : null,
        documentTypeId: '',
        academicYear: '',
        remarks: '',
        dynamicMetadata: {},
        thumbnail: imageDataUrl
      }
      updated = [...filesWithMetadata, newFile]
    }
    setFilesWithMetadata(updated)
    setDocumentFound(false)
    setEdgesUncertain(false)

    // With auto-crop off the wording stays exactly as it was; the toggle's
    // result is only reported when the user asked for automatic cropping.
    const cropNote = !autoCropEnabled
      ? ''
      : croppedPage
        ? ' Page detected and cropped.'
        : ' No page edges found, so the full frame was saved.'

    setMessage({
      type: 'success',
      text: (wasRetake
        ? 'Replacement captured — its details were kept.'
        : `Capture ${updated.length} added to the queue. Position the next page and capture again.`) + cropNote
    })
  }

  const handleFinishScanning = () => {
    stopCamera()
    setRetakeIndex(null)
    if (filesWithMetadata.length > 0) {
      setCurrentFileIndex(0)
      setCurrentStudent(filesWithMetadata[0].student || (isStudentWorkflow ? batchStudent : null))
      setCurrentDocType(filesWithMetadata[0].documentTypeId)
      setCurrentAcademicYear(filesWithMetadata[0].academicYear)
      setCurrentRemarks(filesWithMetadata[0].remarks)
      setCurrentDynamic(filesWithMetadata[0].dynamicMetadata || {})
      setSearchTerm('')
      setStep('details')
    } else {
      setStep('files')
    }
  }

  const handleCancelCamera = () => {
    stopCamera()
    setRetakeIndex(null)
    setStep('files')
    setCameraError('')
  }

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      cameraActiveRef.current = false
      stopCamera()
      if (overlayCanvasRef.current) {
        const ctx = overlayCanvasRef.current.getContext('2d')
        if (ctx) ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height)
      }
    }
  }, [])

  const handleDeleteCapture = (index: number) => {
    setConfirmDialog({
      title: 'Delete Scanned Document?',
      message: 'This scan has not yet been archived. Are you sure you want to remove it?',
      confirmLabel: 'Delete',
      danger: true,
      action: () => executeDeleteCapture(index)
    })
  }

  const executeDeleteCapture = (index: number) => {
    const updated = filesWithMetadata.filter((_, i) => i !== index)
    if (retakeIndex === index) setRetakeIndex(null)
    else if (retakeIndex !== null && retakeIndex > index) setRetakeIndex(retakeIndex - 1)
    setFilesWithMetadata(updated)
    if (updated.length === 0) {
      stopCamera()
      setStep('files')
    }
  }

  const handleRetakeCapture = (index: number) => {
    setRetakeIndex(index)
    setStep('camera')
    startCamera(deviceId || undefined)
  }

  const handleEditCapture = async (index: number) => {
    const file = filesWithMetadata[index]
    if (!file) return
    if (!isEditableImage(file)) {
      setMessage({ type: 'error', text: 'Only image files can be edited. PDF and document files cannot be cropped or rotated.' })
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
      return
    }
    await openImageInEditor(index, file)
  }

  const resetAll = () => {
    stopCamera()
    setStep('mode')
    setWorkflow(null)
    setFilesWithMetadata([])
    setCurrentFileIndex(0)
    setCurrentStudent(null)
    setCurrentDocType('')
    setCurrentAcademicYear('')
    setCurrentRemarks('')
    setCurrentDynamic({})
    setBatchResults([])
    setBatchStudent(null)
    setSearchTerm('')
    editQueueRef.current = []
    setEditAllImagesMode(false)
  }

  // Write the current file's in-progress form fields back into filesWithMetadata
  // (without validation) so details survive navigating away and back.
  const persistCurrentFileMetadata = (): FileWithMetadata[] => {
    const updatedFiles = [...filesWithMetadata]
    const file = updatedFiles[currentFileIndex]
    if (file) {
      const student = isStudentWorkflow
        ? batchStudent
        : (currentStudent || file.student)
      updatedFiles[currentFileIndex] = {
        ...file,
        student,
        documentTypeId: currentDocType,
        academicYear: currentAcademicYear,
        remarks: currentRemarks,
        dynamicMetadata: { ...currentDynamic }
      }
      setFilesWithMetadata(updatedFiles)
    }
    return updatedFiles
  }

  // Populate the form fields from a file's stored metadata
  const loadFileMetadata = (file: FileWithMetadata) => {
    setCurrentStudent(isStudentWorkflow ? batchStudent : file.student)
    setCurrentDocType(file.documentTypeId)
    setCurrentAcademicYear(file.academicYear)
    setCurrentRemarks(file.remarks)
    setCurrentDynamic(file.dynamicMetadata || {})
    setSearchTerm('')
  }

  const handleNextFile = () => {
    const updatedFiles = persistCurrentFileMetadata()
    if (currentFileIndex < updatedFiles.length - 1) {
      const nextIndex = currentFileIndex + 1
      loadFileMetadata(updatedFiles[nextIndex])
      setCurrentFileIndex(nextIndex)
    }
  }

  const handlePreviousFile = () => {
    const updatedFiles = persistCurrentFileMetadata()
    if (currentFileIndex > 0) {
      const prevIndex = currentFileIndex - 1
      loadFileMetadata(updatedFiles[prevIndex])
      setCurrentFileIndex(prevIndex)
    }
  }

  const handleJumpToFile = (index: number) => {
    if (index === currentFileIndex) return
    const updatedFiles = persistCurrentFileMetadata()
    loadFileMetadata(updatedFiles[index])
    setCurrentFileIndex(index)
  }

  const handleCopyFromPrevious = () => {
    if (currentFileIndex === 0) return
    const prev = filesWithMetadata[currentFileIndex - 1]
    setCurrentDocType(prev.documentTypeId)
    setCurrentAcademicYear(prev.academicYear)
    setCurrentRemarks(prev.remarks)
    setCurrentDynamic({ ...(prev.dynamicMetadata || {}) })
    if (!isStudentWorkflow) setCurrentStudent(prev.student)
    setMessage({ type: 'success', text: 'Copied details from the previous document.' })
    setTimeout(() => setMessage({ type: '', text: '' }), 2000)
  }

  const handleImageEdit = (editedImageData: string) => {
    const index = editorTargetRef.current
    editorTargetRef.current = null

    if (index !== null) {
      // Only the accepted result is stored; the untouched capture stays in
      // filePath so Reset All can still reach it
      setFilesWithMetadata(prev => prev.map((f, i) => (
        i === index ? { ...f, editedDataUrl: editedImageData, thumbnail: editedImageData } : f
      )))
    }

    // "Edit All Images" walks the queue one document at a time. The last image
    // empties the queue, so the sequence ends here too — otherwise the mode
    // flag would stay set and lock the button out for the rest of the batch.
    if (editAllImagesMode) {
      const nextIndex = editQueueRef.current.shift()
      const nextFile = nextIndex === undefined ? undefined : filesWithMetadata[nextIndex]
      if (nextIndex !== undefined && nextFile) {
        void openImageInEditor(nextIndex, nextFile)
        return
      }

      setEditAllImagesMode(false)
      editQueueRef.current = []
      setShowImageEditor(false)
      setCapturedImage(null)
      setMessage({ type: 'success', text: 'All images edited successfully!' })
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
      return
    }

    setShowImageEditor(false)
    setCapturedImage(null)
    setMessage({ type: 'success', text: 'Scan accepted and updated.' })
    setTimeout(() => setMessage({ type: '', text: '' }), 2500)
  }

  /**
   * Helper function to open a specific image in the editor. The image is passed
   * untouched — cropping and edge detection only run when the user clicks the
   * buttons inside the editor.
   * Used by both individual edit and "Edit All Images" sequence.
   */
  const openImageInEditor = async (index: number, fileData: FileWithMetadata) => {
    editorTargetRef.current = index
    
    let imageDataUrl: string
    if (fileData.editedDataUrl || fileData.isDataUrl) {
      imageDataUrl = fileData.editedDataUrl || fileData.filePath
    } else {
      // Read from disk
      const result = await window.electronAPI.readPickedFileAsBase64(fileData.filePath)
      if (!result.success) {
        setMessage({ type: 'error', text: `Could not read file: ${result.error}` })
        return
      }
      imageDataUrl = `data:${result.mimeType};base64,${result.base64}`
    }

    setCapturedImage(imageDataUrl)
    setShowImageEditor(true)
  }

  /**
   * Start sequential "Edit All Images" workflow.
   * Opens each editable image in sequence, waiting for user to save before showing next.
   */
  const handleEditAllImages = () => {
    // Only images can be edited — PDFs and Office documents are skipped
    const editableIndices = filesWithMetadata
      .map((file, index) => (isEditableImage(file) ? index : -1))
      .filter(index => index >= 0)

    if (editableIndices.length === 0) {
      setMessage({ type: 'info', text: 'No editable images found in the batch.' })
      setTimeout(() => setMessage({ type: '', text: '' }), 2500)
      return
    }

    // Start the sequence from the first image in the queue
    setEditAllImagesMode(true)
    editQueueRef.current = [...editableIndices]
    
    const firstIndex = editQueueRef.current.shift()
    if (firstIndex !== undefined) {
      const firstFile = filesWithMetadata[firstIndex]
      void openImageInEditor(firstIndex, firstFile)
    }
  }

  const handleImageEditCancel = () => {
    editorTargetRef.current = null

    // If canceling during "Edit All Images" mode, stop the sequence
    if (editAllImagesMode) {
      setEditAllImagesMode(false)
      editQueueRef.current = []
      setMessage({ type: 'info', text: 'Sequential editing cancelled. Remaining images were not edited.' })
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
    }

    setShowImageEditor(false)
    setCapturedImage(null)
    setMessage({ type: '', text: '' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const finalized = persistCurrentFileMetadata()

    // Guard: nothing is queued. Bail out BEFORE touching the loading flags so the
    // save overlay never flashes and the user gets a clear, actionable message
    // instead of the generic "No documents to import" error.
    if (finalized.length === 0) {
      showError('Please select or scan at least one document before saving.')
      return
    }

    // Validate EVERY document independently using the single validateDocument function
    const incomplete = finalized
      .map((f, i) => ({ index: i, errors: validateDocument(f, documentTypes) }))
      .filter(x => x.errors.length > 0)
    if (incomplete.length > 0) {
      const first = incomplete[0]
      const summary = incomplete
        .slice(0, 3)
        .map(x => `Document ${x.index + 1} — ${x.errors.join(', ')}`)
        .join('; ')
      showError(`${incomplete.length} of ${finalized.length} document(s) are incomplete and need attention: ${summary}.`)
      handleJumpToFile(first.index)
      return
    }

    setIsProcessing(true)
    setIsSaving(true)
    setMessage({ type: '', text: '' })
    setBatchResults([])

    try {
      const archiveResult = await window.electronAPI.getSetting('archive_directory')
      const archiveDir = archiveResult.value || 'Archive'

      const batchDocuments = []
      const results: BatchResult[] = []

      for (const fileData of finalized) {
        try {
          const docType = documentTypes.find(dt => dt.id === parseInt(fileData.documentTypeId))
          if (!docType) {
            results.push({ filePath: fileData.file.name, success: false, error: 'Invalid document type' })
            continue
          }

          const student = fileData.student
          const ext = fileData.isDataUrl ? 'jpg' : (fileData.file.name.split('.').pop() || 'jpg')

          // Backend builds the destination: student folder tree, or
          // <Archive>/General Documents/<DocType>/ when no student is set
          const folderResult = await window.electronAPI.generateFolderPath(
            student ? student.id : null,
            docType.id,
            docType.name,
            archiveDir,
            ext
          )

          if (!folderResult.success) {
            results.push({ filePath: fileData.file.name, success: false, error: folderResult.error })
            continue
          }

          const fileName = folderResult.fileName
          const destPath = folderResult.destPath

          let copyResult

          if (fileData.editedDataUrl || fileData.isDataUrl) {
            const imageDataToSave = fileData.editedDataUrl || fileData.filePath
            copyResult = await window.electronAPI.saveBase64Image(imageDataToSave, fileName, destPath)
          } else {
            copyResult = await window.electronAPI.copyFile(fileData.filePath, destPath)
          }

          if (!copyResult.success) {
            results.push({ filePath: fileData.file.name, success: false, error: copyResult.error })
            continue
          }

          batchDocuments.push({
            student_id: student ? student.id : null,
            document_type_id: parseInt(fileData.documentTypeId),
            file_name: fileName,
            file_path: copyResult.filePath,
            metadata: {
              academic_year: fileData.academicYear || null,
              remarks: fileData.remarks || null,
              ...(fileData.dynamicMetadata || {})
            }
          })

          results.push({ filePath: fileData.file.name, success: true })
        } catch (error) {
          results.push({ filePath: fileData.file.name, success: false, error: getErrorMessage(error) || 'Unknown error' })
        }
      }

      if (batchDocuments.length > 0) {
        const batchResult = await window.electronAPI.createDocumentsBatch(batchDocuments, user.id)

        if (!batchResult.success) {
          console.error('Batch creation failed:', batchResult.error)
          showError(`Batch creation failed: ${batchResult.error}`)
          setBatchResults(results)
          setIsProcessing(false)
          setIsSaving(false)
          return
        }
      } else {
        // Nothing was queued for the DB write. With the empty-queue guard above,
        // this only happens when every file failed to copy — surface those errors
        // instead of a generic message.
        setBatchResults(results)
        const failedCount = results.filter(r => !r.success).length
        showError(
          failedCount > 0
            ? `No documents could be archived — ${failedCount} file(s) failed to save. See the list below.`
            : 'No documents to import.'
        )
        setIsProcessing(false)
        setIsSaving(false)
        return
      }

      setBatchResults(results)
      const successCount = results.filter(r => r.success).length
      const failCount = results.filter(r => !r.success).length

      if (failCount === 0) {
        setMessage({ type: 'success', text: `Successfully imported ${successCount} document(s)!` })
      } else {
        showError(`Batch Partially Completed: ${successCount} document(s) archived successfully. ${failCount} could not be archived — see the list below.`)
      }

      // Reset form after showing results
      setTimeout(() => {
        if (failCount === 0) {
          resetAll()
          setIsSaving(false)
        } else {
          setIsSaving(false)
        }
      }, 3000)

    } catch (error) {
      console.error('Batch import failed:', error)
      showError(`An error occurred: ${getErrorMessage(error)}`)
      setIsSaving(false)
    } finally {
      setIsProcessing(false)
    }
  }

  const filteredStudents = filterStudents(students, searchTerm)

  const handleStartWorkflow = (wf: Workflow) => {
    setWorkflow(wf)
    setBatchStudent(null)
    setFilesWithMetadata([])
    setCurrentFileIndex(0)
    if (wf === 'single-student-upload' || wf === 'single-student-scan') {
      setStep('selectStudent')
    } else {
      setStep('files')
    }
  }

  // Picking a student on the Select Student screen locks them for the whole session
  const handlePickBatchStudent = (s: Student) => {
    const reassigning = filesWithMetadata.length > 0
    if (reassigning && batchStudent) {
      // Reached via Change Student with staged documents — confirmation already given
      setFilesWithMetadata(prev => prev.map(f => ({ ...f, student: s })))
      setMessage({ type: 'success', text: `All ${filesWithMetadata.length} document(s) reassigned to ${s.first_name} ${s.last_name}.` })
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
    }
    setBatchStudent(s)
    setCurrentStudent(s)
    setSearchTerm('')
    setStep('files')
  }

  // The ONLY way to change the session student once locked
  const handleChangeStudent = () => {
    if (filesWithMetadata.length === 0) {
      setStep('selectStudent')
      return
    }
    const n = filesWithMetadata.length
    const name = batchStudent ? `${batchStudent.first_name} ${batchStudent.last_name} (${formatStudentYear(batchStudent)})` : 'the selected student'
    setConfirmDialog({
      title: 'Change Student?',
      message: `You currently have ${n} document(s) prepared for ${name}.\n\nChanging the selected student will associate all documents in this current batch with the new student.`,
      confirmLabel: 'Change Student',
      action: () => setStep('selectStudent')
    })
  }

  return (
    <div className="mx-auto max-w-[1420px] p-5 sm:p-7">
      <PageHeader
        eyebrow="Document Management"
        title="Import Documents"
        description="Archive documents for one known student, or digitize a mixed stack with Mixed-Batch Import."
      />

      {/* Message Alert */}
      {message.text && (
        <div className={cn(
          'mb-5 rounded-md px-4 py-3 text-xs',
          message.type === 'success' && 'bg-[#e5f5ee] text-[#2b9b72]',
          message.type === 'info' && 'bg-[#fdf6e7] text-[#8a5a12]',
          message.type === 'error' && 'bg-[#fff0ef] text-[#b94843]'
        )}>
          {message.text}
        </div>
      )}

      {/* Workflow indicator (once a workflow has started) */}
      <WorkflowBanner
        workflow={workflow}
        step={step}
        isStudentWorkflow={isStudentWorkflow}
        batchStudent={batchStudent}
        isProcessing={isProcessing}
        onResetAll={resetAll}
        onChangeStudent={handleChangeStudent}
      />

      {/* STEP: Entry — four workflows */}
      {step === 'mode' && <WorkflowPicker onStartWorkflow={handleStartWorkflow} />}

      {/* STEP: Student selection (Student workflows only) — search disappears once a student is picked */}
      {step === 'selectStudent' && (
        <div className="surface-card rounded-lg p-6">
          <h3 className="text-base font-bold text-[#182a43] mb-1">
            Select Student
          </h3>
          <p className="mb-5 text-sm text-[#718096]">
            {filesWithMetadata.length > 0
              ? `Choosing a different student will assign all ${filesWithMetadata.length} document(s) in this batch to them.`
              : 'All documents added in this session will be archived under this student.'}
          </p>
          <SessionStudentPicker
            onPick={handlePickBatchStudent}
            currentStudent={currentStudent}
            setCurrentStudent={setCurrentStudent}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            filteredStudents={filteredStudents}
            openAddStudentForm={openAddStudentForm}
          />
        </div>
      )}

      {/* STEP: File acquisition method */}
      {step === 'files' && (
        <StepFileAcquisition
          workflow={workflow}
          isScanWorkflow={isScanWorkflow}
          onStartScan={handleStartScan}
          onFileSelect={handleFileSelect}
        />
      )}

      {/* STEP: Camera — continuous capture with queue */}
      {step === 'camera' && (
        <div className="space-y-4">
          <div className="surface-card rounded-lg overflow-hidden">
            {cameraError && (
              <div className="flex items-start gap-2 border-b border-[#f0d5d3] bg-[#fff0ef] px-5 py-3">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#b94843]" />
                <p className="text-xs font-semibold text-[#b94843]">
                  {cameraError} The camera controls stay available — pick another camera from the
                  dropdown, change the quality option, or retry.
                </p>
              </div>
            )}
            <>
                {/* Camera controls */}
                <div className="flex flex-wrap items-end gap-4 border-b border-[#e8ebef] px-5 py-3">
                  <div>
                    <label className="label-caps mb-1 block">Camera</label>
                    <select
                      value={deviceId}
                      onChange={(e) => handleSwitchCamera(e.target.value)}
                      className="h-9 rounded-md border border-[#d9dfe7] bg-white px-2 text-xs text-[#47576b] outline-none focus:border-[#5688bd]"
                    >
                      <option value="">Default camera</option>
                      {videoDevices.map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label-caps mb-1 block">Quality</label>
                    <select
                      value={selectedQuality}
                      onChange={(e) => { void handleQualityChange(e.target.value) }}
                      disabled={!cameraStream || qualityOptions.length === 0}
                      className="h-9 rounded-md border border-[#d9dfe7] bg-white px-2 text-xs text-[#47576b] outline-none focus:border-[#5688bd] disabled:opacity-50"
                    >
                      {qualityOptions.length === 0 && <option value="">Reading camera capabilities…</option>}
                      {qualityOptions.map(q => (
                        <option key={cameraQualityKey(q)} value={cameraQualityKey(q)}>{q.label}</option>
                      ))}
                    </select>
                    {activeResolution && (
                      <div className="mono mt-1 text-[10px] text-[#536d89]">Live: {activeResolution}</div>
                    )}
                  </div>
                  <div>
                    <label className="label-caps mb-1 block">Auto-Crop Scan</label>
                    <button
                      type="button"
                      onClick={handleToggleAutoCrop}
                      aria-pressed={autoCropEnabled}
                      className={cn(
                        'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-bold transition focus-ring',
                        autoCropEnabled
                          ? 'border-[#2b9b72] bg-[#e5f5ee] text-[#22735a]'
                          : 'border-[#d9dfe7] bg-white text-[#718096] hover:bg-[#f4f6f8]'
                      )}
                    >
                      <span className={cn(
                        'relative inline-flex h-4 w-7 items-center rounded-full transition',
                        autoCropEnabled ? 'bg-[#2b9b72]' : 'bg-[#c3ccd6]'
                      )}>
                        <span className={cn(
                          'absolute h-3 w-3 rounded-full bg-white transition-all',
                          autoCropEnabled ? 'left-3.5' : 'left-0.5'
                        )} />
                      </span>
                      {autoCropEnabled ? 'On' : 'Off'}
                    </button>
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    {retakeIndex !== null && (
                      <span className="rounded-full bg-[#fff6df] px-3 py-1 text-[11px] font-bold text-[#b17f22]">
                        Retaking document {retakeIndex + 1} — its details will be kept
                      </span>
                    )}
                    <span className="text-xs text-[#718096]">
                      Scanned: {filesWithMetadata.length} document{filesWithMetadata.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={handleCancelCamera}
                      className="rounded-md px-3 py-1.5 text-xs font-bold text-[#536d89] hover:bg-[#f1f4f7]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                {/* Live preview */}
                <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain"
                  />
                  {/* jscanify outline: same box as the video and the same letterboxing */}
                  <canvas
                    ref={overlayCanvasRef}
                    className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                  />
                  <div className="absolute top-4 left-4 right-4 flex flex-wrap items-start gap-2">
                    <div className="inline-block bg-black/60 backdrop-blur-sm rounded-md px-3 py-2">
                      <p className="text-white text-xs font-medium">
                        Position document in frame. Capture as many as you need — tagging comes after.
                      </p>
                    </div>
                    <div className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[11px] font-bold backdrop-blur-sm',
                      !autoCropEnabled
                        ? 'bg-black/60 text-white/70'
                        : scannerState === 'ready' && documentFound
                        ? 'bg-[#14532d]/80 text-[#bbf7d0]'
                        : scannerState === 'failed'
                          ? 'bg-[#7f1d1d]/80 text-[#fecaca]'
                          : scannerState === 'ready' && edgesUncertain
                            ? 'bg-[#78350f]/80 text-[#fde68a]'
                            : 'bg-black/60 text-white/70'
                    )}>
                      <span className={cn(
                        'h-2 w-2 rounded-full',
                        !autoCropEnabled
                          ? 'bg-white/50'
                          : scannerState === 'ready' && documentFound
                          ? 'bg-[#22c55e]'
                          : scannerState === 'failed'
                            ? 'bg-[#f87171]'
                            : scannerState === 'ready' && edgesUncertain
                              ? 'bg-[#f59e0b]'
                              : 'bg-white/50'
                      )} />
                      {!autoCropEnabled && 'Auto-crop is OFF — plain capture'}
                      {autoCropEnabled && scannerState === 'loading' && 'Starting document detection…'}
                      {autoCropEnabled && scannerState === 'failed' && 'Auto-detection unavailable — capture and crop manually'}
                      {autoCropEnabled && scannerState === 'ready' && (documentFound
                        ? 'Document detected — press Capture'
                        : edgesUncertain
                          ? 'Edges are unsure — use Edit on this capture to adjust the corners'
                          : 'Looking for document edges…')}
                    </div>
                  </div>
                </div>

                <div className="p-5 flex flex-col items-center gap-4">
                  <button
                    onClick={handleCapturePhoto}
                    disabled={!cameraStream}
                    className="inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 text-sm font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Camera size={20} />
                    {retakeIndex !== null ? 'Capture Replacement' : 'Capture Document'}
                  </button>
                  <p className="text-[11px] text-[#718096]">
                    {autoCropEnabled
                      ? 'Each capture is cropped automatically to the detected page and the camera stays on — position the next page and capture again.'
                      : 'Each capture is added to the queue exactly as framed and the camera stays on — position the next page and capture again.'}{' '}
                    {autoCropEnabled
                      ? 'Use Edit whenever you want to adjust the crop.'
                      : 'You can still edit any capture manually below.'}
                  </p>

                  <button
                    onClick={handleFinishScanning}
                    disabled={filesWithMetadata.length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Finish Scanning ({filesWithMetadata.length})
                  </button>
                </div>
              </>
          </div>

          {/* Scanned queue */}
          {filesWithMetadata.length > 0 && (
            <ScannedQueue
              filesWithMetadata={filesWithMetadata}
              onEditCapture={handleEditCapture}
              onRetakeCapture={handleRetakeCapture}
              onDeleteCapture={handleDeleteCapture}
            />
          )}
        </div>
      )}

      {/* STEP: Tagging + review */}
      {step === 'details' && currentFile && (
        <form onSubmit={handleSubmit}>
          {/* Review table */}
          <ReviewTable
            filesWithMetadata={filesWithMetadata}
            reviewSlice={reviewSlice}
            reviewStart={reviewStart}
            documentTypes={documentTypes}
            currentFileIndex={currentFileIndex}
            isStudentWorkflow={isStudentWorkflow}
            readyCount={readyCount}
            editableImageCount={editableImageCount}
            reviewPage={reviewPage}
            onJumpToFile={handleJumpToFile}
            onEditAllImages={handleEditAllImages}
            onReviewPageChange={setReviewPage}
          />

          {/* Per-file tagging */}
          <div className="surface-card rounded-lg p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#1c2f47]">
                Document {currentFileIndex + 1} of {filesWithMetadata.length}
              </h3>
              <div className="text-xs text-[#718096]">
                {readyCount} / {filesWithMetadata.length} ready
              </div>
            </div>

            {/* Current file display */}
            <div className="mb-3 flex items-center gap-3 rounded-md border border-[#e1e5ea] bg-[#f8fafc] p-3">
              {currentFile.thumbnail || currentFile.isDataUrl ? (
                <img src={currentFile.editedDataUrl || currentFile.filePath} alt="" className="h-10 w-10 rounded object-cover" />
              ) : (
                <FileText size={16} className="text-[#536d89]" />
              )}
              <span className="flex-1 text-xs font-bold text-[#263950]">{currentFile.file.name}</span>
              {isScanWorkflow && (
                <button
                  type="button"
                  onClick={() => handleRetakeCapture(currentFileIndex)}
                  className="text-xs font-bold text-[#536d89] hover:text-[#1d4778] transition"
                >
                  Retake
                </button>
              )}
              {isEditableImage(currentFile) && (
                  <button
                    type="button"
                    onClick={() => handleEditCapture(currentFileIndex)}
                    className="text-xs font-bold text-[#24558d] hover:text-[#1d4778] transition"
                  >
                    Edit Image
                  </button>
              )}
            </div>

            {/* Navigation buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePreviousFile}
                disabled={currentFileIndex === 0}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <button
                type="button"
                onClick={handleNextFile}
                disabled={currentFileIndex === filesWithMetadata.length - 1}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>

          <div className="surface-card rounded-lg p-5 space-y-4">
            <h3 className="text-sm font-bold text-[#1c2f47]">Document Details</h3>

            {/* Student selection — mixed-batch workflows, only when doc type requires it */}
            {!isStudentWorkflow && (
              <DocumentStudentField
                studentRequiredForCurrent={studentRequiredForCurrent}
                currentDocType={currentDocType}
                currentStudent={currentStudent}
                setCurrentStudent={setCurrentStudent}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                filteredStudents={filteredStudents}
                openAddStudentForm={openAddStudentForm}
                onPickCurrentStudent={handlePickCurrentStudent}
              />
            )}

            {/* Document Type */}
            <div>
              <label className="label-caps mb-1.5 block">
                Document Type <span className="text-[#b94843]">*</span>
              </label>
              <select
                value={currentDocType}
                onChange={(e) => setCurrentDocType(e.target.value)}
                required
                className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#47576b] outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
              >
                <option value="">Select document type...</option>
                {documentTypes.map(type => (
                  <option key={type.id} value={type.id}>{type.name}</option>
                ))}
              </select>
            </div>

            {/* End of metadata fields */}

            {/* Academic Year */}
            <div>
              <label className="label-caps mb-1.5 block">Academic Year</label>
              <input
                type="text"
                value={currentAcademicYear}
                onChange={(e) => setCurrentAcademicYear(e.target.value)}
                placeholder="e.g., 2024-2025"
                className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
              />
            </div>

            {/* Remarks */}
            <div>
              <label className="label-caps mb-1.5 block">Remarks</label>
              <textarea
                value={currentRemarks}
                onChange={(e) => setCurrentRemarks(e.target.value)}
                placeholder="Optional notes..."
                rows={3}
                className="w-full rounded-md border border-[#d9dfe7] bg-white px-3 py-2 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
              />
            </div>

            {/* Batch Results */}
            {batchResults.length > 0 && <BatchResultsList batchResults={batchResults} />}

            {/* Submit Buttons */}
            <ImportActionBar
              filesWithMetadata={filesWithMetadata}
              currentFileIndex={currentFileIndex}
              isProcessing={isProcessing}
              readyCount={readyCount}
              onCopyFromPrevious={handleCopyFromPrevious}
              onResetAll={resetAll}
            />
          </div>
        </form>
      )}

      {/* Image Editor Modal */}
      {showImageEditor && capturedImage && (
        <ImageEditorModal
          capturedImage={capturedImage}
          onSave={handleImageEdit}
          onCancel={handleImageEditCancel}
        />
      )}

      {/* Add New Student Modal — opened from a student search with no matches */}
      {showAddStudentForm && (
        <AddStudentModal
          newStudentForm={newStudentForm}
          setNewStudentForm={setNewStudentForm}
          addStudentMessage={addStudentMessage}
          pendingForceAdd={pendingForceAdd}
          setPendingForceAdd={setPendingForceAdd}
          isAddingStudent={isAddingStudent}
          onCreate={handleCreateStudent}
          onClose={closeAddStudentForm}
        />
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

      {/* Loading Overlay for Saving Documents */}
      {isSaving && <SavingOverlay />}
    </div>
  )
}

export default ImportScanner
