/**
 * Session bootstrap shared by the CDP acceptance scripts.
 *
 * Since dsh 0.1.5 every browser-facing Host route lives on the Connection
 * `/api` carrier, and that carrier requires a browser session — there is no
 * method-specific loopback tier. A script therefore exchanges the launch token
 * printed by `dsh web` for the auth cookie once and reuses it for both its
 * Node-side RPC calls and the page navigation.
 *
 * Set DSH_WEB_TOKEN to the `?token=` value of the URL `dsh web` prints; set
 * DSH_BASE to override the default http://127.0.0.1:3190.
 */

/** Base URL of the test instance. */
export const BASE = process.env.DSH_BASE ?? 'http://127.0.0.1:3190'

/** The launch token, required for every script run. */
function launchToken() {
  const value = process.env.DSH_WEB_TOKEN
  if (value === undefined || value.length === 0) {
    throw new Error(
      'DSH_WEB_TOKEN is required: copy the ?token= value from the URL dsh web printed',
    )
  }
  return value
}

/**
 * Exchange the launch token for the browser-session cookie.
 * @param {string} base - instance base URL.
 * @returns {Promise<string>} the `name=value` cookie pair.
 */
export async function authCookie(base = BASE) {
  const response = await fetch(`${base}/?token=${encodeURIComponent(launchToken())}`, {
    redirect: 'manual',
  })
  const setCookie =
    response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? undefined
  if (setCookie === undefined) {
    throw new Error(`token exchange failed: HTTP ${response.status}`)
  }
  return setCookie.split(';', 1)[0]
}

/**
 * URL that loads the app and authenticates the tab in one navigation.
 * @param {string} base - instance base URL.
 * @returns {string} the authenticated page URL.
 */
export function authenticatedUrl(base = BASE) {
  return `${base}/?token=${encodeURIComponent(launchToken())}`
}

/**
 * Authenticated POST to one task-runner endpoint on the shared `/api` channel.
 * @param {string} method - endpoint name such as `tasks/list`.
 * @param {unknown} payload - endpoint payload.
 * @param {string} base - instance base URL.
 * @returns {Promise<unknown>} the endpoint's success value.
 */
export async function rpc(method, payload, base = BASE) {
  const cookie = await authCookie(base)
  // The wire method is the namespaced endpoint, i.e. the route path below /api.
  const wireMethod = `task-runner/${method}`
  const response = await fetch(`${base}/api/${wireMethod}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `script-${method.replaceAll('/', '-')}-${Date.now()}`,
      method: wireMethod,
      payload,
    }),
  })
  if (!response.ok) throw new Error(`${method} failed: HTTP ${response.status}`)
  const body = await response.json()
  if (body?.result?.ok !== true) throw new Error(`${method} failed: ${JSON.stringify(body)}`)
  return body.result.value
}
