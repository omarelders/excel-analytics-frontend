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
