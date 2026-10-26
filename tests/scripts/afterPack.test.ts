import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'

// The hook is CommonJS and only needs @electron/fuses, so it loads in Node.
const require = createRequire(import.meta.url)
const { afterPack, resolveExePath, buildFuseOptions, applyFuses } = require('../../scripts/afterPack.cjs') as {
  afterPack: (context: unknown) => Promise<void>
  resolveExePath: (context: unknown) => string | null
  buildFuseOptions: () => Record<string, unknown>
  applyFuses: (options: {
    exePath: string
    exists: (exePath: string) => boolean
    flip: (exePath: string, options: unknown) => Promise<unknown>
  }) => Promise<unknown>
}
const { FuseVersion, FuseV1Options } = require('@electron/fuses')

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const winContext = () => ({
  electronPlatformName: 'win32',
  appOutDir: path.join('release', 'win-unpacked'),
  packager: { appInfo: { productFilename: 'AdZU Registrar Archive' } }
})

describe('resolveExePath', () => {
  it('points at the packaged exe on Windows', () => {
    expect(resolveExePath(winContext())).toBe(
      path.join('release', 'win-unpacked', 'AdZU Registrar Archive.exe')
    )
  })

  it('skips other platforms', () => {
    expect(resolveExePath({ ...winContext(), electronPlatformName: 'darwin' })).toBeNull()
    expect(resolveExePath({ ...winContext(), electronPlatformName: 'linux' })).toBeNull()
  })
})

describe('buildFuseOptions', () => {
  it('disables RunAsNode and the two Node injection switches', () => {
    expect(buildFuseOptions()).toEqual({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false
    })
  })

  it('leaves the fuses that need companion changes alone', () => {
    const keys = Object.keys(buildFuseOptions())
    expect(keys).toHaveLength(4)
    expect(keys).not.toContain(String(FuseV1Options.EnableCookieEncryption))
    expect(keys).not.toContain(String(FuseV1Options.EnableEmbeddedAsarIntegrityValidation))
    expect(keys).not.toContain(String(FuseV1Options.OnlyLoadAppFromAsar))
    expect(keys).not.toContain(String(FuseV1Options.LoadBrowserProcessSpecificV8Snapshot))
    expect(keys).not.toContain(String(FuseV1Options.GrantFileProtocolExtraPrivileges))
  })
})

describe('applyFuses', () => {
  it('flips the fuses on the packaged exe', async () => {
    const exePath = path.join('release', 'win-unpacked', 'AdZU Registrar Archive.exe')
    const flip = vi.fn().mockResolvedValue(undefined)

    await applyFuses({ exePath, exists: () => true, flip })

    expect(flip).toHaveBeenCalledTimes(1)
    expect(flip).toHaveBeenCalledWith(exePath, buildFuseOptions())
  })

  it('refuses to report success when the exe is missing', async () => {
    const flip = vi.fn()

    await expect(applyFuses({ exePath: 'missing.exe', exists: () => false, flip })).rejects.toThrow(
      'no executable at missing.exe'
    )
    expect(flip).not.toHaveBeenCalled()
  })
})

describe('afterPack hook', () => {
  it('does nothing for a non-Windows target', async () => {
    await expect(afterPack({ ...winContext(), electronPlatformName: 'darwin' })).resolves.toBeUndefined()
  })

  it('fails loudly when a Windows build produced no exe', async () => {
    await expect(
      afterPack({ ...winContext(), appOutDir: path.join('tests', 'no-such-out-dir') })
    ).rejects.toThrow('no executable at')
  })

  it('is the hook electron-builder runs', () => {
    const pkg = JSON.parse(read('../../package.json')) as { build: { afterPack: string } }
    expect(pkg.build.afterPack).toBe('scripts/afterPack.cjs')
    expect(read('../../scripts/afterPack.cjs')).toContain('module.exports = { afterPack')
  })
})
