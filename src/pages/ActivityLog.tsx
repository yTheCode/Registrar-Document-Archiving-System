import { useState, useEffect } from 'react'
import { Shield, FileText, RefreshCw } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatTimestamp } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader'
import Pagination from '@/components/ui/Pagination'
import SortHeader from '@/components/ui/SortHeader'
import type { PageProps, Log } from '@/types'

const LOG_PAGE_SIZE = 25

function ActivityLog({ user }: PageProps) {
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
            Activity logs are only available to administrators.
          </p>
        </div>
      </div>
    )
  }

  const [logs, setLogs] = useState<Log[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [sortBy, setSortBy] = useState('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    loadLogs()
  }, [])

  const loadLogs = async (opts?: { page?: number; sortBy?: string; sortDir?: 'asc' | 'desc' }) => {
    const p = opts?.page ?? page
    const sb = opts?.sortBy ?? sortBy
    const sd = opts?.sortDir ?? sortDir
    setIsLoading(true)
    const result = await window.electronAPI.getRecentLogs(LOG_PAGE_SIZE, user.id, (p - 1) * LOG_PAGE_SIZE, sb, sd)
    if (result.success) {
      setLogs(result.logs)
      setTotal(result.total ?? result.logs.length)
      setPage(p)
      setSortBy(sb)
      setSortDir(sd)
    } else {
      console.error('Failed to load activity logs:', result.error)
    }
    setIsLoading(false)
  }

  const handleSort = (column: string) => {
    if (column === sortBy) {
      loadLogs({ page: 1, sortBy, sortDir: sortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      loadLogs({ page: 1, sortBy: column, sortDir: 'asc' })
    }
  }

  const getActionColor = (action: string) => {
    const actionLower = action.toLowerCase()
    if (actionLower.includes('create') || actionLower.includes('add')) {
      return 'bg-[#e5f5ee] text-[#2b9b72]'
    }
    if (actionLower.includes('update') || actionLower.includes('edit')) {
      return 'bg-[#dceafb] text-[#24558d]'
    }
    if (actionLower.includes('delete') || actionLower.includes('remove')) {
      return 'bg-[#fff0ef] text-[#b94843]'
    }
    if (actionLower.includes('print')) {
      return 'bg-[#f0e6ff] text-[#6b4ba1]'
    }
    if (actionLower.includes('share') || actionLower.includes('export')) {
      return 'bg-[#fff6df] text-[#b17f22]'
    }
    if (actionLower.includes('login')) {
      return 'bg-[#fff6df] text-[#b17f22]'
    }
    if (actionLower.includes('logout')) {
      return 'bg-[#f0f3f7] text-[#8793a3]'
    }
    return 'bg-[#f0f3f7] text-[#617084]'
  }

  return (
    <div className="mx-auto max-w-[1420px] p-5 sm:p-7">
      <PageHeader
        eyebrow="System Audit"
        title="Activity Log"
        description="Complete history of all system activities and user actions."
        actions={
          <button
            onClick={() => loadLogs()}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778] disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(isLoading && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      <div className="surface-card rounded-lg">
        {isLoading ? (
          <div className="p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#eaf0f7] mb-4">
              <RefreshCw size={24} className="text-[#536d89] animate-spin" />
            </div>
            <p className="text-sm text-[#617084]">Loading activity logs...</p>
          </div>
        ) : logs.length > 0 ? (
          <>
            <div className="border-b border-[#e8ebef] px-5 py-3.5">
              <div className="text-[11px] font-bold text-[#8a95a5]">
                {total} total activit{total !== 1 ? 'ies' : 'y'}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#edf0f3]">
                    <SortHeader label="Date & Time" column="created_at" sort={{ sortBy, sortDir }} onSort={handleSort} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#8a95a5]" />
                    <SortHeader label="User" column="username" sort={{ sortBy, sortDir }} onSort={handleSort} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#8a95a5]" />
                    <SortHeader label="Action" column="action" sort={{ sortBy, sortDir }} onSort={handleSort} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#8a95a5]" />
                    <SortHeader label="Target" column="target_type" sort={{ sortBy, sortDir }} onSort={handleSort} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#8a95a5]" />
                    <th className="px-5 py-3 text-left">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#8a95a5]">
                        Details
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f3f7]">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#fafbfc] transition">
                      <td className="px-5 py-3">
                        <div className="text-[11px] text-[#617084]">
                          {formatTimestamp(log.created_at)}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eaf0f7] text-[10px] font-bold text-[#315c87]">
                            {log.username[0].toUpperCase()}
                          </div>
                          <span className="text-xs font-semibold text-[#263950]">
                            {log.username}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold',
                          getActionColor(log.action)
                        )}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-xs text-[#617084]">
                          {log.target_type && log.target_id ? (
                            <>
                              <span className="font-medium text-[#47576b]">{log.target_type}</span>
                              {' '}
                              <span className="text-[#a4adba]">#{log.target_id}</span>
                            </>
                          ) : (
                            <span className="text-[#d4d8de]">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-xs text-[#617084] max-w-md truncate" title={log.details || ''}>
                          {log.details || <span className="text-[#d4d8de]">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[#e8ebef] px-5 py-3">
              <Pagination
                page={page}
                pageSize={LOG_PAGE_SIZE}
                total={total}
                onPageChange={(p) => loadLogs({ page: p })}
              />
            </div>
          </>
        ) : (
          <div className="p-12 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#f8fafc] mb-4">
              <FileText size={28} className="text-[#a4adba]" />
            </div>
            <h3 className="text-sm font-bold text-[#47576b] mb-1">No Activity Logs</h3>
            <p className="text-xs text-[#8a95a5]">
              System activities will appear here as they occur.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ActivityLog
