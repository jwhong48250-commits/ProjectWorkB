/** 로컬에서 https/누락된 포트로 백엔드 URL이 잡히는 경우를 보정합니다. */
function normalizeLocalDevHostUrl(raw: string): string {
  const s = raw.trim().replace(/\/+$/, '')
  if (!s) return s
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s)
    const u = new URL(hasScheme ? s : `http://${s}`)
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      if (u.protocol === 'https:') u.protocol = 'http:'
      if (!u.port || u.port === '443') u.port = '8000'
    }
    return u.toString().replace(/\/+$/, '')
  } catch {
    return s
  }
}

function normalizeOrigin(raw: string): string {
  let base = normalizeLocalDevHostUrl(raw)
  base = base.replace(/\/+$/, '')

  // Some setups mistakenly include the API prefix in the base URL.
  // Our callers append `/api/v1` themselves, so strip it if present.
  base = base.replace(/\/api\/v1$/i, '')

  return base
}

export function getApiOrigin(): string {
  const raw =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
    (import.meta.env.VITE_API_URL as string | undefined) ??
    'http://127.0.0.1:8000/api/v1'

  if (!raw.trim()) {
    throw new Error('VITE_API_BASE_URL is not set')
  }

  return normalizeOrigin(raw)
}

export function getApiV1BaseUrl(): string {
  return `${getApiOrigin()}/api/v1`
}

