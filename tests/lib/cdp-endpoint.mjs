/**
 * DevTools endpoint shared by the CDP acceptance scripts.
 *
 * The default stays http://127.0.0.1:9222 so existing usage keeps working, but
 * a run can point the scripts at a privately started headless Chrome when the
 * default port is occupied by an unrelated process:
 *
 *   DSH_CDP_HTTP=http://127.0.0.1:19222 node tests/cdp-refresh.mjs
 *   DSH_CDP_PORT=19222 node tests/cdp-refresh.mjs
 *
 * DSH_CDP_HTTP wins when both are set; empty values count as unset.
 */

const DEFAULT_PORT = '9222'

/** Read an environment variable, treating empty strings as unset. */
function envValue(name) {
  const value = process.env[name]
  return value === undefined || value.length === 0 ? undefined : value
}

/** DevTools HTTP base URL: DSH_CDP_HTTP, else http://127.0.0.1:<DSH_CDP_PORT>, default 9222. */
export const CDP_HTTP = envValue('DSH_CDP_HTTP') ?? `http://127.0.0.1:${envValue('DSH_CDP_PORT') ?? DEFAULT_PORT}`

/** DevTools port actually in use, derived from CDP_HTTP. */
export const CDP_PORT = new URL(CDP_HTTP).port || DEFAULT_PORT
