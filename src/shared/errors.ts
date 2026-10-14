export type ErrorCode = 'auth' | 'quota' | 'context_too_long' | 'rate_limit' | 'timeout' | 'network' | 'disconnected' | 'server' | 'not_found' | 'bad_request' | 'http' | 'aborted' | 'unknown'

export class ProviderError extends Error {
  /** raw server error body (truncated) and a redacted summary of the request, shown in the error details */
  body?: string
  request?: any
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

/** map a provider error response (status + body) to a specific readable error code.
 *  Covers OpenAI / DeepSeek / xAI / Qwen (DashScope) / Anthropic / Gemini / Ollama error shapes. */
export function classifyError(status: number, body: string): ErrorCode {
  const b = body.toLowerCase()
  if (/insufficient[_ ]quota|insufficient[_ ]balance|exceeded your current quota|billing|credit balance is too low|payment required|arrearage|余额不足|quota exceeded for/.test(b) || status === 402) return 'quota'
  if (/context[_ ]length[_ ]exceeded|maximum context length|context window|too many tokens|prompt is too long|input is too long|reduce the length|token limit|max_tokens.*too large|上下文长度/.test(b)) return 'context_too_long'
  if (/invalid[_ ]api[_ ]key|incorrect api key|invalid x-api-key|authentication|unauthorized|api key not valid|permission[_ ]denied/.test(b) && (status === 400 || status === 401 || status === 403)) return 'auth'
  if (/model[_ ]not[_ ]found|does not exist|no such model|unknown model|model .* not found|is not found for api version|not supported for generatecontent/.test(b)) return 'not_found'
  if (/rate[_ ]limit|too many requests|resource[_ ]exhausted/.test(b) && status !== 402) return status === 429 || /rate/.test(b) ? 'rate_limit' : codeForStatus(status)
  if (/overloaded/.test(b)) return 'server'
  return codeForStatus(status)
}

export const RETRYABLE: ErrorCode[] = ['rate_limit', 'server', 'timeout', 'network']

export interface RetryOptions { retries: number; baseMs: number; maxMs?: number; signal?: AbortSignal; onRetry?: (attempt: number, delayMs: number, e: ProviderError) => void }

/** retry `fn` with exponential backoff (+ jitter) on retryable errors; `canRetry()` lets callers stop retrying once output started */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions, canRetry: () => boolean = () => true): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(attempt) } catch (e: any) {
      const pe = e instanceof ProviderError ? e : null
      if (!pe || !RETRYABLE.includes(pe.code) || attempt >= o.retries || !canRetry() || o.signal?.aborted) throw e
      const delay = Math.min(o.maxMs ?? 30000, o.baseMs * 2 ** attempt) * (0.85 + Math.random() * 0.3)
      o.onRetry?.(attempt + 1, Math.round(delay), pe)
      await new Promise<void>((res, rej) => {
        const t = setTimeout(res, delay)
        o.signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')) }, { once: true })
      })
    }
  }
}
