import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createUrlPolicy } = require('../../../electron/security/senderGuard.cjs') as {
  createUrlPolicy: (options?: { indexFileUrl?: string; devServerOrigin?: string | null }) => (url: unknown) => boolean
}

// Same shape as the real value: a Windows file URL with an encoded space.
const INDEX_URL = 'file:///D:/CODE%20STUFF/app/dist/index.html'

const packaged = () => createUrlPolicy({ indexFileUrl: INDEX_URL, devServerOrigin: null })
const dev = () => createUrlPolicy({ indexFileUrl: INDEX_URL, devServerOrigin: 'http://localhost:5173' })

describe('createUrlPolicy (packaged)', () => {
  const isAllowed = packaged()

  it('allows the packaged index.html URL', () => {
    expect(isAllowed(INDEX_URL)).toBe(true)
  })

  it('treats the drive letter and path case as insensitive', () => {
    expect(isAllowed('file:///d:/code stuff/app/dist/index.html')).toBe(true)
  })

  it('ignores the query and hash', () => {
    expect(isAllowed(`${INDEX_URL}#/students`)).toBe(true)
  })

  it('allows the route URLs BrowserRouter pushes onto a file:// document', () => {
    // Verified against the packaged build: these are the hrefs the app holds
    // after the "/" route and after navigating to Students.
    expect(isAllowed('file:///D:/')).toBe(true)
    expect(isAllowed('file:///D:/students')).toBe(true)
  })

  it('rejects local file pages outside the app', () => {
    expect(isAllowed('file:///D:/students.html')).toBe(false)
    expect(isAllowed('file:///D:/Users/someone/evil.html')).toBe(false)
    expect(isAllowed('file:///C:/evil.html')).toBe(false)
    expect(isAllowed('file:///D:/index.html/../../evil.html')).toBe(false)
  })

  it('rejects every non-file URL, including the dev server when it is not configured', () => {
    expect(isAllowed('https://evil.example/')).toBe(false)
    expect(isAllowed('http://localhost:5173/')).toBe(false)
    expect(isAllowed('data:text/html,<script>1</script>')).toBe(false)
    expect(isAllowed('about:blank')).toBe(false)
  })

  it('rejects anything that is not a parseable URL string', () => {
    expect(isAllowed('')).toBe(false)
    expect(isAllowed('   ')).toBe(false)
    expect(isAllowed('not a url')).toBe(false)
    expect(isAllowed(null)).toBe(false)
    expect(isAllowed(undefined)).toBe(false)
    expect(isAllowed(42)).toBe(false)
    expect(isAllowed('file:///D:/bad%zz')).toBe(false)
  })
})

describe('createUrlPolicy (dev server)', () => {
  const isAllowed = dev()

  it('allows pages served by the Vite dev server', () => {
    expect(isAllowed('http://localhost:5173')).toBe(true)
    expect(isAllowed('http://localhost:5173/')).toBe(true)
    expect(isAllowed('http://localhost:5173/students')).toBe(true)
  })

  it('rejects any other origin, scheme or port', () => {
    expect(isAllowed('http://localhost:5174/')).toBe(false)
    expect(isAllowed('https://localhost:5173/')).toBe(false)
    expect(isAllowed('https://evil.example/')).toBe(false)
  })

  it('still allows the packaged index.html URL', () => {
    expect(isAllowed(INDEX_URL)).toBe(true)
  })
})

describe('createUrlPolicy (misconfigured)', () => {
  it('denies everything when no valid index file URL is supplied', () => {
    expect(createUrlPolicy()('file:///D:/students')).toBe(false)
    expect(createUrlPolicy({ indexFileUrl: 'not a url' })('file:///D:/students')).toBe(false)
  })
})
