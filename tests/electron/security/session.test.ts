import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

// Plain CommonJS, no electron/db import: required directly, nothing stubbed.
const require = createRequire(import.meta.url)
const { createSession, session: sharedSession } = require('../../../electron/security/session.cjs') as {
  createSession: () => {
    get: () => { userId: number | string; username: string; role: string } | null
    set: (user: { id: number | string; username?: string; role?: string } | null) => void
    clear: () => void
    isCurrentUser: (userId: unknown) => boolean
  }
  session: ReturnType<typeof createSession>
}

const admin = { id: 1, username: 'admin', role: 'admin' }

describe('createSession', () => {
  it('starts empty', () => {
    const s = createSession()
    expect(s.get()).toBeNull()
    expect(s.isCurrentUser(1)).toBe(false)
  })

  it('stores a snapshot of the logged-in user', () => {
    const s = createSession()
    s.set(admin)
    expect(s.get()).toEqual({ userId: 1, username: 'admin', role: 'admin' })
  })

  it('does not change when the login result object is mutated afterwards', () => {
    const s = createSession()
    const loginResult = { id: 1, username: 'admin', role: 'admin' }
    s.set(loginResult)
    loginResult.id = 99
    loginResult.role = 'user'
    expect(s.get()).toEqual({ userId: 1, username: 'admin', role: 'admin' })
  })

  it('does not expose its internal state through get()', () => {
    const s = createSession()
    s.set(admin)
    const copy = s.get()
    expect(copy).not.toBeNull()
    copy!.role = 'user'
    expect(s.get()!.role).toBe('admin')
  })

  it('keeps one session: a second set replaces the first', () => {
    const s = createSession()
    s.set(admin)
    s.set({ id: 2, username: 'user', role: 'user' })
    expect(s.get()).toEqual({ userId: 2, username: 'user', role: 'user' })
    expect(s.isCurrentUser(1)).toBe(false)
    expect(s.isCurrentUser(2)).toBe(true)
  })

  it('clears back to empty', () => {
    const s = createSession()
    s.set(admin)
    s.clear()
    expect(s.get()).toBeNull()
    expect(s.isCurrentUser(1)).toBe(false)
  })

  it('treats set(null) as a clear', () => {
    const s = createSession()
    s.set(admin)
    s.set(null)
    expect(s.get()).toBeNull()
  })

  it('isCurrentUser matches on id value, not on type', () => {
    const s = createSession()
    s.set(admin)
    expect(s.isCurrentUser(1)).toBe(true)
    expect(s.isCurrentUser('1')).toBe(true)
    expect(s.isCurrentUser(' 1')).toBe(false)
    expect(s.isCurrentUser(2)).toBe(false)
    expect(s.isCurrentUser('2')).toBe(false)
    expect(s.isCurrentUser(null)).toBe(false)
    expect(s.isCurrentUser(undefined)).toBe(false)
  })

  it('isCurrentUser accepts a string session id against a numeric argument', () => {
    const s = createSession()
    s.set({ id: '1', username: 'admin', role: 'admin' })
    expect(s.isCurrentUser(1)).toBe(true)
  })

  it('gives every createSession() its own state', () => {
    const a = createSession()
    const b = createSession()
    a.set(admin)
    expect(b.get()).toBeNull()
  })

  it('exports one shared instance for the main process', () => {
    expect(sharedSession.get()).toBeNull()
    sharedSession.set(admin)
    expect(sharedSession.isCurrentUser(1)).toBe(true)
    sharedSession.clear()
    expect(sharedSession.get()).toBeNull()
  })
})
