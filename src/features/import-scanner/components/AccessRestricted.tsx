import { Upload } from 'lucide-react'

function AccessRestricted() {
  return (
    <div className="mx-auto max-w-[1420px] p-5 sm:p-7">
      <div className="surface-card rounded-lg p-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#fff6df] mb-4">
          <Upload size={28} className="text-[#b17f22]" />
        </div>
        <h2 className="text-lg font-bold text-[#182a43] mb-2">Access Restricted</h2>
        <p className="text-sm text-[#718096]">
          Document upload and scanning is only available to administrators.
        </p>
      </div>
    </div>
  )
}

export default AccessRestricted
