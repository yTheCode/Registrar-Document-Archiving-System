// Pure archive-root decision. No electron, no paths.cjs, no database: the
// stored value and the default are injected, so this loads in plain Node.
//
// A blank or whitespace-only setting means "not configured" and must never be
// used as a path — `'   '` would otherwise resolve to the process working
// directory.
function resolveArchiveRoot(settingValue, defaultRoot) {
  if (typeof settingValue === 'string') {
    const trimmed = settingValue.trim();
    if (trimmed) return trimmed;
  }
  return defaultRoot;
}

module.exports = { resolveArchiveRoot };
