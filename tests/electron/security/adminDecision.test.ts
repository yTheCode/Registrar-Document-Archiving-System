import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

// Pure module: no db, no electron, no fs.
const require = createRequire(import.meta.url)
const { decideAdmin } = require('../../../electron/security/adminDecision.cjs') as {
  decideAdmin: (input?: {
    session?: { userId: number | string; username?: string; role?: string } | null
    userId?: unknown
    row?: { role?: string; status?: string } | null
  }) => boolean
}

const liveSession = { userId: 1, username: 'admin', role: 'admin' }
const activeAdminRow = { role: 'admin', status: 'active' }

describe('decideAdmin', () => {
  it('allows the session owner when the live row is an active admin', () => {
    expect(decideAdmin({ session: liveSession, userId: 1, row: activeAdminRow })).toBe(true)
  })

  it('rejects when there is no session', () => {
    expect(decideAdmin({ session: null, userId: 1, row: activeAdminRow })).toBe(false)
    expect(decideAdmin({ userId: 1, row: activeAdminRow })).toBe(false)
    expect(decideAdmin()).toBe(false)
  })

  it('rejects a different account id (the renderer-supplied id trick)', () => {
    expect(decideAdmin({ session: liveSession, userId: 2, row: activeAdminRow })).toBe(false)
    expect(decideAdmin({ session: { userId: 2, role: 'user' }, userId: 1, row: activeAdminRow })).toBe(false)
  })

  it('treats "1" and 1 as the same id', () => {
    expect(decideAdmin({ session: liveSession, userId: '1', row: activeAdminRow })).toBe(true)
    expect(decideAdmin({ session: { userId: '1' }, userId: 1, row: activeAdminRow })).toBe(true)
    expect(decideAdmin({ session: liveSession, userId: ' 1', row: activeAdminRow })).toBe(false)
    expect(decideAdmin({ session: liveSession, userId: '1.0', row: activeAdminRow })).toBe(false)
  })

  it('rejects a missing id', () => {
    expect(decideAdmin({ session: liveSession, userId: null, row: activeAdminRow })).toBe(false)
    expect(decideAdmin({ session: liveSession, userId: undefined, row: activeAdminRow })).toBe(false)
  })

  it('rejects an inactive admin (deactivation takes effect immediately)', () => {
    expect(decideAdmin({ session: liveSession, userId: 1, row: { role: 'admin', status: 'inactive' } })).toBe(false)
    expect(decideAdmin({ session: liveSession, userId: 1, row: { role: 'admin' } })).toBe(false)
    expect(decideAdmin({ session: liveSession, userId: 1, row: { role: 'admin', status: null } })).toBe(false)
  })

  it('rejects an active non-admin', () => {
    expect(decideAdmin({ session: liveSession, userId: 1, row: { role: 'user', status: 'active' } })).toBe(false)
  })

  it('rejects when the account row no longer exists', () => {
    expect(decideAdmin({ session: liveSession, userId: 1, row: null })).toBe(false)
    expect(decideAdmin({ session: liveSession, userId: 1, row: undefined })).toBe(false)
  })

  it('does not trust the role stored in the session', () => {
    // the row is the source of truth; a session that claims admin cannot
    // promote a row that says otherwise
    expect(
      decideAdmin({ session: { userId: 1, role: 'admin' }, userId: 1, row: { role: 'user', status: 'active' } })
    ).toBe(false)
    expect(decideAdmin({ session: { userId: 1, role: 'user' }, userId: 1, row: activeAdminRow })).toBe(true)
  })
})
