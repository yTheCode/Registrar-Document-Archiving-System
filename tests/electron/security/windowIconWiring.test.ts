import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

// The icon paths cannot be exercised outside electron-builder, so the wiring is
// pinned at the source level like the other main/preload wiring tests.
const readText = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const readBytes = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)))

const pkg = JSON.parse(readText('../../../package.json')) as {
  build: {
    win: { icon: string }
    extraResources?: { from: string; to: string }[]
  }
}
const main = readText('../../../electron/main.cjs')
const layout = readText('../../../src/components/Layout.tsx')
const login = readText('../../../src/pages/Login.tsx')

describe('window icon and app logo', () => {
  it('builds the exe and installs a resource icon from build/', () => {
    expect(pkg.build.win.icon).toBe('build/icon.ico')
    expect(pkg.build.extraResources).toEqual([{ from: 'build/icon.png', to: 'icon.png' }])
  })

  it('reads the packaged icon from resourcesPath and the source file in dev', () => {
    expect(main).toContain("const WINDOW_ICON_PATH = isDev")
    expect(main).toContain("path.join(__dirname, '../build/icon.png')")
    expect(main).toContain("path.join(process.resourcesPath, 'icon.png')")
    expect(main).toContain('icon: WINDOW_ICON_PATH')
    expect(main).not.toContain('adzu-seal')
  })

  it('ships an ICO with every size Windows asks for', () => {
    const ico = readBytes('../../../build/icon.ico')
    const count = ico.readUInt16LE(4)
    const sizes = Array.from({ length: count }, (_, i) => {
      const entry = 6 + 16 * i
      return ico[entry] || 256
    })
    for (const size of [16, 24, 32, 48, 64, 128, 256]) {
      expect(`${size}: ${sizes.includes(size)}`).toBe(`${size}: true`)
    }
  })

  it('shows the new logo in the sidebar and both login placements, seal gone', () => {
    for (const [name, source] of [
      ['Layout', layout],
      ['Login', login]
    ]) {
      expect(`${name}: ${source.includes("from '@/assets/logo-256.png'")}`).toBe(`${name}: true`)
      expect(`${name}: ${source.includes('adzu-seal.png')}`).toBe(`${name}: false`)
      expect(`${name}: ${source.includes('alt="AdZU Registrar Archive logo"')}`).toBe(`${name}: true`)
    }
    // Display sizes are unchanged by the swap.
    expect(layout).toContain('className="mx-auto mb-3 h-16 w-16 object-contain"')
    expect(login).toContain('className="h-9 w-9 object-contain"')
    expect(login).toContain('className="mb-8 h-[172px] w-[172px] object-contain drop-shadow-xl"')
  })
})
