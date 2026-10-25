export const describeCameraError = (error: unknown): string => {
  let friendly = 'Failed to access the camera. Please try again.'
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    friendly = 'Camera permission was denied. Allow camera access and try again.'
  } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    friendly = 'No camera was detected. Connect a webcam or document camera and try again.'
  } else if (name === 'NotReadableError' || name === 'TrackStartError') {
    friendly = 'The selected camera may be in use by another application. Close the other application and try again.'
  } else if (name === 'OverconstrainedError') {
    friendly = 'The selected camera could not satisfy the requested settings. Choose another camera or a lower quality option.'
  }
  return friendly
}
