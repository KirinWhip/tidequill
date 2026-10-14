import { Storage, type KV } from '../shared/storage'
import { ProviderError } from '../shared/errors'
declare global { interface Window { api: any } }

const hasApi = typeof window !== 'undefined' && !!window.api
// Fallback for running the renderer in a plain browser (vite dev without electron)
export const api = hasApi ? window.api : {
  kvGet: async (k: string) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : undefined },
  kvSet: async (k: string, v: any) => localStorage.setItem(k, JSON.stringify(v)),
  secureStatus: async () => ({ available: false }), setProxy: async () => {}, locale: async () => navigator.language, setLanguage: async () => {},
  saveFile: async (name: string, content: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content])); a.download = name; a.click(); return true },
  openFile: async () => null,
  syncTools: async () => ({ plugins: [], mcp: [] }), toolStatus: async () => ({ plugins: [], mcp: [] }), toolGrants: async () => ({ plugins: {}, mcp: {}, grants: [] }), revokeTool: async () => ({ plugins: {}, mcp: {}, grants: [] }), revokeAllTools: async () => ({ plugins: {}, mcp: {}, grants: [] }), trustPlugin: async () => ({ ok: false }), untrustPlugin: async () => ({}), mcpPreview: async (c: any) => ({ commandLine: [c?.command, ...(c?.args || [])].join(' '), envKeys: [], approved: false }), mcpApprove: async () => true, mcpRevoke: async () => ({}), storageNotices: async () => [], dismissStorageNotices: async () => {}, setDevMode: async () => ({}),
  copyText: (s: string) => navigator.clipboard.writeText(s), applySystem: async () => ({}), checkUpdate: async () => ({ status: 'unsupported' }), downloadUpdate: async () => false, installUpdate: async () => {}, exportPdf: async () => false, onCommand: () => {}, listTools: async () => [], callTool: async () => 'unavailable', openPluginDir: async () => {}, version: async () => 'web', about: async () => ({ name: 'Tidequill', version: 'web', license: 'MIT', author: '', repo: '' }), notices: async () => '', openRepo: async () => {},
  httpStart: null, httpAbort: () => {}, httpDone: () => {},
}
const kv: KV = { get: k => api.kvGet(k), set: (k, v) => api.kvSet(k, v) }
export const storage = new Storage(kv)

let timeoutMs = 60000
export const setRequestTimeout = (sec: number) => { timeoutMs = Math.max(1, sec || 60) * 1000 }

const NULL_BODY = new Set([101, 204, 205, 304])
let seq = 0

type Start = (id: string, req: any, onEvent: (ev: any) => void) => void
/** builds a fetch() replacement that performs the request elsewhere (main process) and streams the response back as events */
export function createBridgeFetch(start: Start, abort: (id: string) => void, done: (id: string) => void, getTimeout: () => number): typeof fetch {
  return ((input: any, init: RequestInit = {}) => {
    const id = `r${Date.now()}_${seq++}`
    return new Promise<Response>((resolve, reject) => {
      let ctl: ReadableStreamDefaultController<Uint8Array> | null = null
      let settled = false
      const abortErr = () => new DOMException('Aborted', 'AbortError')
      if (init.signal?.aborted) { reject(abortErr()); return }
      init.signal?.addEventListener('abort', () => {
        abort(id)
        if (!settled) { settled = true; reject(abortErr()) } else { try { ctl?.error(abortErr()) } catch { /* closed */ } }
        done(id)
      })
      start(id, { url: String(input), method: init.method || 'GET', headers: init.headers as any, body: init.body as string, timeoutMs: getTimeout() }, (ev: any) => {
        if (ev.type === 'head') {
          settled = true
          const body = NULL_BODY.has(ev.status) ? null : new ReadableStream<Uint8Array>({ start(c) { ctl = c } })
          resolve(new Response(body, { status: ev.status, headers: ev.headers }))
        } else if (ev.type === 'chunk') {
          try { ctl?.enqueue(ev.data instanceof Uint8Array ? ev.data : new Uint8Array(ev.data)) } catch { /* closed */ }
        } else if (ev.type === 'end') {
          try { ctl?.close() } catch { /* closed */ }
          done(id)
        } else if (ev.type === 'error') {
          const err = ev.code === 'aborted' ? abortErr() : new ProviderError(ev.code, ev.message)
          if (!settled) { settled = true; reject(err) } else { try { ctl?.error(err) } catch { /* closed */ } }
          done(id)
        }
      })
    })
  }) as typeof fetch
}

export const bridgeFetch: typeof fetch = api.httpStart
  ? createBridgeFetch(api.httpStart, api.httpAbort, api.httpDone, () => timeoutMs)
  : fetch
