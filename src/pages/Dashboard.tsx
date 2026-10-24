import { useState, useEffect } from 'react'
import { Folder, FileText, Clock } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatDate, formatStudentYear } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import DocumentViewerModal from '@/components/DocumentViewerModal'
import type { PageProps, DashboardStats, ArchiveDocument } from '@/types'

function StatCard({ 
  label, 
  value, 
  helper, 
  icon, 
  tone 
}: { 
  label: string
  value: string | number
  helper: string
  icon: React.ReactNode
  tone: 'navy' | 'gold' | 'green' | 'amber'
}) {
  const toneClasses = {
    navy: 'bg-[#edf2f7] text-[#536d89]',
    gold: 'bg-[#fff6df] text-[#ab7e20]',
    green: 'bg-[#e5f5ee] text-[#2b9b72]',
    amber: 'bg-[#fff6df] text-[#b17f22]'
  }

  const valueClasses = {
    navy: 'text-[#1c2f47]',
    gold: 'text-[#1c2f47]',
    green: 'text-[#278763]',
    amber: 'text-[#a9791d]'
  }

  return (
    <div className="surface-card rounded-lg p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="label-caps">{label}</div>
          <div className={cn(
            'mt-2 text-[27px] font-bold tracking-[-.04em]',
            valueClasses[tone]
          )}>
            {value}
          </div>
        </div>
        <div className={cn('rounded-full p-2.5', toneClasses[tone])}>
          {icon}
        </div>
      </div>
      <div className="mt-1 text-[11px] text-[#8490a0]">{helper}</div>
    </div>
  )
}

function Dashboard({ user }: PageProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // Same dedicated viewing interface as the Search and Students pages
  const [viewingDoc, setViewingDoc] = useState<ArchiveDocument | null>(null)

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    setIsLoading(true)
    try {
      const result = await window.electronAPI.getDashboardStats()
      if (result.success) {
        setStats(result.stats)
      }
    } catch (error) {
      console.error('Error loading stats:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const viewDocument = (doc: ArchiveDocument) => {
    setViewingDoc(doc)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#24558d] border-r-transparent"></div>
          <p className="mt-3 text-sm text-[#8490a0]">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  // For Regular Staff - read-only view
  if (user.role === 'user') {
    return (
      <div className="mx-auto max-w-[1420px] p-5 sm:p-7">
        <PageHeader
          eyebrow="Registrar e-Archiving System"
          title="Archive Dashboard"
          description="Your read-only view of student records."
        />

        <div className="grid gap-4 md:grid-cols-2">
          <StatCard
            label="Student records"
            value={stats?.totalStudents || 0}
            helper="Available for search"
            icon={<Folder size={17} />}
            tone="navy"
          />
          <StatCard
            label="Indexed documents"
            value={stats?.totalDocuments || 0}
            helper="Available to view and print"
            icon={<FileText size={17} />}
            tone="gold"
          />
        </div>
      </div>
    )
  }

  // For Admin Users - full dashboard
  return (
    <div className="mx-auto max-w-[1420px] p-5 sm:p-7">
      <PageHeader
        eyebrow="Registrar e-Archiving System"
        title="Archive Dashboard"
        description="Current state of the local student document archive."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Student records"
          value={stats?.totalStudents || 0}
          helper="Students archived in this system"
          icon={<Folder size={17} />}
          tone="navy"
        />
        <StatCard
          label="Total documents"
          value={stats?.totalDocuments || 0}
          helper="Documents stored in the archive"
          icon={<FileText size={17} />}
          tone="gold"
        />
        <StatCard
          label="Recent uploads"
          value={stats?.recentDocuments?.length || 0}
          helper="Latest additions to the archive"
          icon={<Clock size={17} />}
          tone="green"
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr]">
        <section className="surface-card rounded-lg">
          <div className="flex items-center justify-between border-b border-[#e8ebef] px-5 py-4">
            <div>
              <h2 className="text-sm font-bold text-[#1c2f47]">Recent Documents</h2>
              <p className="mt-0.5 text-[11px] text-[#8a95a5]">
                Latest documents added to the archive. Select a row to open the file.
              </p>
            </div>
          </div>

          {stats?.recentDocuments && stats.recentDocuments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#e8ebef] bg-[#fafbfc] text-[10px] uppercase tracking-[.1em] text-[#8a96a5]">
                    <th className="px-5 py-3 font-bold">Student</th>
                    <th className="px-4 py-3 font-bold">Document Type</th>
                    <th className="px-4 py-3 font-bold">File Name</th>
                    <th className="px-4 py-3 font-bold">Archived By</th>
                    <th className="px-5 py-3 font-bold">Date Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf0f3]">
                  {stats.recentDocuments.map((doc: ArchiveDocument) => (
                    <tr
                      key={doc.id}
                      className="cursor-pointer transition hover:bg-slate-50"
                      onClick={() => viewDocument(doc)}
                    >
                      <td className="px-5 py-3.5">
                        {doc.first_name ? (
                          <>
                            <div className="text-xs font-bold text-[#263950]">
                              {doc.first_name} {doc.last_name}
                            </div>
                            <div className="mono mt-0.5 text-[10px] text-[#8995a4]">
                              {formatStudentYear(doc)}
                            </div>
                          </>
                        ) : (
                          <div className="text-xs text-[#8a95a5]">General document</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-[#617084]">
                        {doc.document_type}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="mono text-[11px] text-[#4a5b70] truncate max-w-[250px]">
                          {doc.file_name}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-[#617084]">
                        {doc.created_by_name}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[#718096]">
                        {formatDate(doc.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={FileText}
              title="No recent documents"
              body="Documents added to the archive will appear here."
            />
          )}
        </section>
      </div>

      {viewingDoc && (
        <DocumentViewerModal
          doc={viewingDoc}
          siblings={stats?.recentDocuments.filter(
            (d) => d.student_id === viewingDoc.student_id && d.document_type_id === viewingDoc.document_type_id
          )}
          userId={user.id}
          userRole={user.role}
          onClose={() => setViewingDoc(null)}
          onUpdate={loadStats}
        />
      )}
    </div>
  )
}

export default Dashboard
