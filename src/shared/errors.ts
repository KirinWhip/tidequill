export type ErrorCode = 'auth' | 'rate_limit' | 'timeout' | 'network' | 'disconnected' | 'server' | 'not_found' | 'bad_request' | 'http' | 'aborted' | 'unknown'

export class ProviderError extends Error {
  constructor(public code: ErrorCode, public detail = '', public status?: number) {
    super(`[${code}]${status ? ' HTTP ' + status : ''} ${detail}`.trim())
    this.name = 'ProviderError'
  }
}

export function codeForStatus(s: number): ErrorCode {
  if (s === 401 || s === 403) return 'auth'
  if (s === 429) return 'rate_limit'
  if (s === 404) return 'not_found'
  if (s === 400 || s === 422) return 'bad_request'
  if (s === 408 || s === 504) return 'timeout'
  if (s >= 500) return 'server'
  return 'http'
}

/** extract a readable message from an API error body */
export function errorDetail(body: string): string {
  try {
    const j = JSON.parse(body)
    return String(j.error?.message || j.error || j.message || body).slice(0, 500)
  } catch { return body.slice(0, 500) }
}

export function toProviderError(e: any, phase: 'connect' | 'stream'): ProviderError {
  if (e instanceof ProviderError) return e
  if (e?.name === 'ProviderError' && e.code) return new ProviderError(e.code, e.detail, e.status)
  return new ProviderError(phase === 'connect' ? 'network' : 'disconnected', String(e?.message || e))
}
