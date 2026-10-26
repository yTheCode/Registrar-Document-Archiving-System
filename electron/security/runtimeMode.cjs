// Q1: an installed copy is production, full stop. The only input is Electron's
// own packaged flag; nothing read from the environment may select dev mode.
// Pure on purpose (no electron, no paths.cjs) so Vitest can load it.
const DEV_SERVER_URL = 'http://localhost:5173';

/**
 * @param {{ isPackaged?: unknown }} options
 * @returns {{ isDev: boolean, devServerUrl: string | null, devTools: boolean }}
 *
 * Fail closed: anything other than the literal `false` is treated as a packaged
 * build, so a missing or misspelled flag can never reach the dev server.
 */
function resolveRuntimeMode(options) {
  const isPackaged = options && options.isPackaged;
  const isDev = isPackaged === false;

  return {
    isDev,
    devServerUrl: isDev ? DEV_SERVER_URL : null,
    devTools: isDev
  };
}

module.exports = { DEV_SERVER_URL, resolveRuntimeMode };
