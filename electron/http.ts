/** Main-process HTTP bridge: renderer asks main to perform provider requests, response is streamed back as events.
 *  Kept free of electron imports so it can be unit-tested with Node's fetch. */
import type { ErrorCode } from '../src/shared/errors'

export interface BridgeRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number // idle timeout: no headers/data for this long -> timeout
}

export type BridgeEvent =
  | { type: 'head'; status: number; headers: Record<string, string> }
  | { type: 'chunk'; data: Uint8Array }
  | { type: 'end' }
  | { type: 'error'; code: ErrorCode; message: string }

export function validateUrl(u: string): boolean {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' } catch { return false }
}

export async function runBridgeRequest(fetchFn: typeof fetch, req: BridgeRequest, emit: (e: BridgeEvent) => void, userAbort: AbortSignal): Promise<void> {
  if (!validateUrl(req.url)) { emit({ type: 'error', code: 'bad_request', message: 'Only http(s) URLs are allowed' }); return }
  const ctrl = new AbortController()
  let timedOut = false
  let timer: any
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctrl.abort() }, req.timeoutMs || 60000) }
  const onUser = () => ctrl.abort()
  userAbort.addEventListener('abort', onUser)
  let gotHead = false
  try {
    arm()
    const res = await fetchFn(req.url, { method: req.method || 'GET', headers: req.headers, body: req.body, signal: ctrl.signal })
    gotHead = true
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k] = v })
    emit({ type: 'head', status: res.status, headers })
    arm()
    if (res.body) {
      const reader = res.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        arm()
        emit({ type: 'chunk', data: value })
      }
    }
    emit({ type: 'end' })
  } catch (e: any) {
    if (timedOut) emit({ type: 'error', code: 'timeout', message: 'Request timed out' })
    else if (userAbort.aborted) emit({ type: 'error', code: 'aborted', message: 'Aborted' })
    else emit({ type: 'error', code: gotHead ? 'disconnected' : 'network', message: String(e?.cause?.message || e?.message || e) })
  } finally {
    clearTimeout(timer)
    userAbort.removeEventListener('abort', onUser)
  }
}
