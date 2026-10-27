import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { isBlockedShortcut } = require('../../../electron/security/blockedKeys.cjs') as {
  isBlockedShortcut: (input?: unknown) => boolean
}

// Electron's before-input-event `input` is a plain object; these are the fields
// the matcher reads. Unlisted modifiers default to false, as Electron sends them.
const keyDown = (key: string, modifiers: Record<string, boolean> = {}) => ({
  type: 'keyDown',
  key,
  shift: false,
  control: false,
  alt: false,
  meta: false,
  ...modifiers
})

describe('isBlockedShortcut', () => {
  it('blocks F12', () => {
    expect(isBlockedShortcut(keyDown('F12'))).toBe(true)
    expect(isBlockedShortcut(keyDown('F12', { control: true }))).toBe(true)
  })

  it('blocks F5, including Ctrl+F5', () => {
    expect(isBlockedShortcut(keyDown('F5'))).toBe(true)
    expect(isBlockedShortcut(keyDown('F5', { control: true }))).toBe(true)
    expect(isBlockedShortcut(keyDown('F5', { shift: true }))).toBe(true)
  })

  it('blocks Ctrl+Shift+I and Ctrl+Shift+J', () => {
    expect(isBlockedShortcut(keyDown('I', { control: true, shift: true }))).toBe(true)
    expect(isBlockedShortcut(keyDown('J', { control: true, shift: true }))).toBe(true)
  })

  it('reads the shifted character Electron reports (uppercase key)', () => {
    expect(isBlockedShortcut(keyDown('i', { control: true, shift: true }))).toBe(true)
    expect(isBlockedShortcut(keyDown('R', { control: true }))).toBe(true)
  })

  it('blocks Ctrl+R and Ctrl+Shift+R', () => {
    expect(isBlockedShortcut(keyDown('r', { control: true }))).toBe(true)
    expect(isBlockedShortcut(keyDown('R', { control: true, shift: true }))).toBe(true)
  })

  it('leaves ordinary typing and unrelated shortcuts alone', () => {
    expect(isBlockedShortcut(keyDown('i'))).toBe(false)
    expect(isBlockedShortcut(keyDown('r'))).toBe(false)
    expect(isBlockedShortcut(keyDown('i', { control: true }))).toBe(false)
    expect(isBlockedShortcut(keyDown('j', { shift: true }))).toBe(false)
    expect(isBlockedShortcut(keyDown('k', { control: true, shift: true }))).toBe(false)
    expect(isBlockedShortcut(keyDown('c', { control: true, shift: true }))).toBe(false)
    expect(isBlockedShortcut(keyDown('F11'))).toBe(false)
    expect(isBlockedShortcut(keyDown('F4', { alt: true }))).toBe(false)
    expect(isBlockedShortcut(keyDown('r', { meta: true }))).toBe(false)
  })

  it('ignores keyUp and char events', () => {
    expect(isBlockedShortcut({ ...keyDown('F12'), type: 'keyUp' })).toBe(false)
    expect(isBlockedShortcut({ ...keyDown('r', { control: true }), type: 'char' })).toBe(false)
  })

  it('does not throw on malformed input', () => {
    expect(isBlockedShortcut()).toBe(false)
    expect(isBlockedShortcut(null)).toBe(false)
    expect(isBlockedShortcut({})).toBe(false)
    expect(isBlockedShortcut({ type: 'keyDown' })).toBe(false)
    expect(isBlockedShortcut({ type: 'keyDown', key: 42 })).toBe(false)
  })

  it('requires the modifiers to be literally true', () => {
    expect(isBlockedShortcut({ type: 'keyDown', key: 'r', control: 'true' })).toBe(false)
    expect(isBlockedShortcut({ type: 'keyDown', key: 'I', control: true, shift: 1 })).toBe(false)
  })
})
