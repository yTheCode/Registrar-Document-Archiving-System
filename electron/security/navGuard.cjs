// Q7: the window may only navigate inside the app's own page, may not open
// pop-ups or attach webviews, and may only open a camera stream.
// Pure (no electron, no paths.cjs) so both decisions can be tested. The URL rule
// is injected: main.cjs passes the same Q6 policy the IPC guard uses, so "the
// app's own page" has exactly one definition in the process.

// Nothing in this app has ever opened a second window or sent a link to the
// system browser (there is no window.open and no anchor in src/), so the
// window-open handler denies unconditionally.
const DENY_WINDOW_OPEN = Object.freeze({ action: 'deny' });

/**
 * @param {{ url?: unknown, isAllowedUrl?: unknown }} options
 * @returns {boolean} true only when the injected policy accepts the URL.
 */
function decideNavigation(options) {
  const { url, isAllowedUrl } = options || {};
  if (typeof url !== 'string' || url === '') return false;
  if (typeof isAllowedUrl !== 'function') return false;

  try {
    return isAllowedUrl(url) === true;
  } catch {
    return false;
  }
}

/**
 * Grants the camera and nothing else.
 *
 * The two Electron handlers describe the same request differently:
 * `setPermissionRequestHandler` gets `details.mediaTypes` (array) while
 * `setPermissionCheckHandler` gets `details.mediaType` (single string). Anything
 * that does not name exactly one video source is denied, which keeps audio,
 * screen capture and every non-media permission out.
 *
 * @param {{ permission?: unknown, details?: unknown }} options
 * @returns {boolean}
 */
function decidePermission(options) {
  const { permission, details } = options || {};
  if (permission !== 'media') return false;

  const info = details && typeof details === 'object' ? details : {};

  if (Array.isArray(info.mediaTypes)) {
    return info.mediaTypes.length > 0 && info.mediaTypes.every(type => type === 'video');
  }

  if (typeof info.mediaType === 'string') {
    return info.mediaType === 'video';
  }

  return false;
}

/**
 * The permission *check* handler answers "may this page see media devices at
 * all?", not "may it open a stream". Chromium hides every device name unless
 * the microphone name check passes, so denying audio here empties the camera
 * list too (measured: `enumerateDevices()` returned a single unnamed entry
 * while `getUserMedia({ video })` worked). A check opens nothing, and
 * `decidePermission` still allows only video requests, so microphone streams
 * stay blocked. Every other permission is denied.
 *
 * @param {{ permission?: unknown }} options
 * @returns {boolean}
 */
function decidePermissionCheck(options) {
  const { permission } = options || {};
  return permission === 'media';
}

module.exports = { DENY_WINDOW_OPEN, decideNavigation, decidePermission, decidePermissionCheck };
