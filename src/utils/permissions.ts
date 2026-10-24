// Who may use each document action. Server-side handlers enforce the same
// rules — this constant governs what the UI offers.
export const DOCUMENT_ACTION_PERMISSIONS = {
  print: ['admin', 'user'],
  share: ['admin'],
  edit: ['admin'],
  delete: ['admin']
} as const

export type DocumentAction = keyof typeof DOCUMENT_ACTION_PERMISSIONS

export function canPerformAction(role: string, action: DocumentAction): boolean {
  return (DOCUMENT_ACTION_PERMISSIONS[action] as readonly string[]).includes(role)
}
