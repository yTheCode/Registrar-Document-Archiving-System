const fs = require('fs');
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

// electron-builder's afterPack hook. Only the Windows build ships an exe we
// own; the macOS and Linux packagers are left at Electron's defaults.
function resolveExePath(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'win32') return null;
  return path.join(appOutDir, `${packager.appInfo.productFilename}.exe`);
}

// Q13. RunAsNode off means ELECTRON_RUN_AS_NODE can no longer turn the app into
// a Node shell; the other two stop NODE_OPTIONS and --inspect from injecting
// code into the main process. ASAR integrity, cookie encryption and the asar
// -only load stay at their defaults: each needs accompanying changes we have
// not made, and a half-enabled fuse breaks the build.
function buildFuseOptions() {
  return {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false
  };
}

async function applyFuses(options) {
  const { exePath, exists, flip } = options;
  if (!exists(exePath)) {
    throw new Error(`afterPack: no executable at ${exePath}`);
  }
  return flip(exePath, buildFuseOptions());
}

async function afterPack(context) {
  const exePath = resolveExePath(context);
  if (exePath === null) return;
  await applyFuses({ exePath, exists: fs.existsSync, flip: flipFuses });
}

module.exports = { afterPack, resolveExePath, buildFuseOptions, applyFuses };
