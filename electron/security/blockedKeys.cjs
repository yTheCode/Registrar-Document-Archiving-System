// Q2: keyboard shortcuts that must not work in a packaged build. They open
// DevTools or reload the app, both of which exist only for development.
// Pure (no electron) so the matching rule can be tested with plain objects
// shaped like Electron's before-input-event `input` argument.
//
// Matching is Windows-specific on purpose: the dev/reload accelerators this app
// must block use Ctrl (the target platform is Windows), and Electron reports the
// already-shifted character in `key`, so Ctrl+Shift+I arrives as key 'I'.

const FUNCTION_KEYS = ['f12', 'f5'];

function isBlockedShortcut(input) {
  if (!input || input.type !== 'keyDown') return false;
  if (typeof input.key !== 'string') return false;

  const key = input.key.toLowerCase();

  // F12 opens DevTools; F5 (and Ctrl+F5) reloads.
  if (FUNCTION_KEYS.includes(key)) return true;

  if (input.control !== true) return false;

  // Ctrl+R and Ctrl+Shift+R reload / force reload.
  if (key === 'r') return true;

  // Ctrl+Shift+I and Ctrl+Shift+J open DevTools and the console.
  return input.shift === true && (key === 'i' || key === 'j');
}

module.exports = { isBlockedShortcut };
