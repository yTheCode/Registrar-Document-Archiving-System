import ImageEditor from '@/components/ImageEditor'

interface ImageEditorModalProps {
  capturedImage: string
  onSave: (editedImageData: string) => void
  onCancel: () => void
}

function ImageEditorModal({ capturedImage, onSave, onCancel }: ImageEditorModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black">
      <ImageEditor
        imageData={capturedImage}
        onSave={onSave}
        onCancel={onCancel}
      />
    </div>
  )
}

export default ImageEditorModal
