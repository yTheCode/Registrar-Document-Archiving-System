// Q6: every IPC call must come from the app's own main window page. This
// module is pure (no electron, no paths.cjs) so tests can drive it with fake
// events; main.cjs injects the real web contents and URL policy.
//
// The URL policy exists because the renderer uses BrowserRouter while the
// packaged window is loaded from dist/index.html over file://: the router's
// first navigation rewrites that page's URL to file:///<drive>:/<route>
// (verified in the packaged build: file:///D:/students). So an exact
// index.html match is the first render only, never the steady state.

function parseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizePathname(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // Both sides are lowercased: Windows paths are case-insensitive and the
  // route names the renderer pushes are lowercase anyway.
  return decoded.toLowerCase();
}

// A file URL the renderer can legitimately hold after BrowserRouter runs on a
// file:// document: the drive root ("/d:/", the "/" route) or one flat route
// under it ("/d:/students") — a single segment with no dot or colon. A page
// loaded from a local file always carries a directory path and a file name,
// so it does not match.
const ROUTE_PATHNAME = /^(?:\/[^/.:]*|\/[a-z]:\/[^/.:]*)$/;

function createUrlPolicy({ indexFileUrl, devServerOrigin } = {}) {
  const indexUrl = parseUrl(indexFileUrl);
  const indexPath = indexUrl && indexUrl.protocol === 'file:' ? normalizePathname(indexUrl.pathname) : null;
  if (indexPath === null) return () => false;

  const devUrl = parseUrl(devServerOrigin);
  const devOrigin = devUrl ? devUrl.origin : null;

  return function isAllowedUrl(rawUrl) {
    const url = parseUrl(rawUrl);
    if (!url) return false;

    // Unpackaged runs load the window from the Vite dev server.
    if (devOrigin !== null && url.origin === devOrigin) return true;
    if (url.protocol !== 'file:') return false;

    const pathname = normalizePathname(url.pathname);
    if (pathname === null) return false;
    if (pathname === indexPath) return true;
    return ROUTE_PATHNAME.test(pathname);
  };
}

function createSenderGuard({ getMainWebContents, isAllowedUrl } = {}) {
  return function validate(event) {
    try {
      const webContents = typeof getMainWebContents === 'function' ? getMainWebContents() : null;
      if (!webContents) return false;
      if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) return false;

      if (!event || event.sender !== webContents) return false;

      const frame = event.senderFrame;
      const mainFrame = webContents.mainFrame;
      if (!frame || !mainFrame) return false;

      // Identity is stable in Electron 28; the node id comparison keeps the
      // check correct if a future version hands out a fresh frame wrapper.
      const isMainFrame =
        frame === mainFrame ||
        (typeof mainFrame.frameTreeNodeId === 'number' && frame.frameTreeNodeId === mainFrame.frameTreeNodeId);
      if (!isMainFrame) return false;

      if (typeof isAllowedUrl !== 'function') return false;
      return isAllowedUrl(frame.url) === true;
    } catch {
      return false;
    }
  };
}

module.exports = { createUrlPolicy, createSenderGuard };
