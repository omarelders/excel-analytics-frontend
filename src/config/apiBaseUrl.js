/**
 * Where the API lives.
 *
 * The API is same-origin on the hosts `vercel.json` proxies for it (see
 * `SAME_ORIGIN_API_HOSTS` and the `*.vercel.app` previews): the rewrites send `/api`,
 * `/shipments`, `/upload`, `/payments`, `/notifications`, `/statuses` and `/health` on
 * to the backend, and the browser sees one origin - which is what the CSP's
 * `connect-src 'self'` requires.
 *
 * `VITE_FORCE_EXTERNAL_API=true` is **incompatible with the shipped CSP**: it points
 * every request at the external origin and the browser then blocks all of them.
 * `scripts/assertSameOriginApi.mjs` fails the build rather than letting that ship;
 * `test/security/api_config.test.mjs` proves the guard fires. Do not set it - see
 * `docs/DEPLOYMENT.md` §2.
 */
const ENV_API_BASE_URL = (import.meta.env.VITE_API_URL || '').trim()
const FORCE_EXTERNAL_API = import.meta.env.VITE_FORCE_EXTERNAL_API === 'true'

const SAME_ORIGIN_API_HOSTS = new Set([
  'roadtoonemillion.me',
  'www.roadtoonemillion.me',
])

const shouldUseSameOriginApi = () => {
  if (FORCE_EXTERNAL_API) {
    return false
  }

  if (typeof window === 'undefined') {
    return false
  }

  const hostname = window.location.hostname
  return SAME_ORIGIN_API_HOSTS.has(hostname) || hostname.endsWith('.vercel.app')
}

export const API_BASE_URL = shouldUseSameOriginApi() ? '' : ENV_API_BASE_URL
