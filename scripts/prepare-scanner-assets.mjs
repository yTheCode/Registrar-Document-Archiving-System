/**
 * Copies jscanify's browser build and its bundled OpenCV.js from node_modules
 * into public/scanner/ so the app loads them as local assets (offline, no CDN).
 *
 * OpenCV.js here embeds its WASM as a base64 data URI, so no .wasm fetch happens
 * at runtime and the files also load correctly from file:// in a packaged build.
 *
 * Never edit the copies: they come from the pinned `jscanify` devDependency.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkgDir = join(root, 'node_modules', 'jscanify')
const outDir = join(root, 'public', 'scanner')
const files = ['opencv.js', 'jscanify.js']

// Skip silently when dependencies are not installed yet (e.g. `npm install` bootstrap)
if (!existsSync(pkgDir)) {
  console.log('[scanner-assets] jscanify is not installed yet — skipping')
  process.exit(0)
}

const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version
mkdirSync(outDir, { recursive: true })

let copied = 0
for (const file of files) {
  const src = join(pkgDir, 'src', file)
  const dest = join(outDir, file)
  if (!existsSync(src)) {
    console.error(`[scanner-assets] missing ${src} — reinstall jscanify`)
    process.exit(1)
  }
  const upToDate = existsSync(dest) && statSync(dest).size === statSync(src).size
  if (!upToDate) {
    copyFileSync(src, dest)
    copied++
  }
}

console.log(
  `[scanner-assets] jscanify@${version} → public/scanner/ (${copied} file(s) copied, ${files.length - copied} already current)`
)
