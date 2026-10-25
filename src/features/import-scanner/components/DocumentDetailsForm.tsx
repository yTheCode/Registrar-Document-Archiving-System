import type { DocumentType } from '@/types'

interface DocumentDetailsFormProps {
  currentDocType: string
  setCurrentDocType: (v: string) => void
  documentTypes: DocumentType[]
  currentAcademicYear: string
  setCurrentAcademicYear: (v: string) => void
  currentRemarks: string
  setCurrentRemarks: (v: string) => void
}

function DocumentDetailsForm({ currentDocType, setCurrentDocType, documentTypes, currentAcademicYear, setCurrentAcademicYear, currentRemarks, setCurrentRemarks }: DocumentDetailsFormProps) {
  return (
    <>
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
    </>
  )
}

export default DocumentDetailsForm
