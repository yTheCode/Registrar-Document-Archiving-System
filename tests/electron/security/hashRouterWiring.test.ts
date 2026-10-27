import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

// The packaged renderer runs from a file:// document, so its router is pinned at
// the source level like the other main/preload wiring tests in this folder.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const app = read('../../../src/App.tsx')
const main = read('../../../src/main.tsx')

describe('renderer router (HashRouter)', () => {
  it('mounts HashRouter and never BrowserRouter', () => {
    expect(app).toContain("import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'")
    expect(app).not.toContain('BrowserRouter as')
    expect(app).toContain('<Router>')
    expect(main).not.toContain('Router')
  })

  it('keeps every route path unchanged by the switch', () => {
    for (const route of ['/', '/search', '/students', '/help', '/import', '/settings', '/logs', '*']) {
      expect(`${route}: ${app.includes(`path="${route}"`)}`).toBe(`${route}: true`)
    }
    expect(app).toContain('<Navigate to="/" replace />')
  })
})
