import { estimateTokens } from './usage'

export interface RequestInfo { url: string; body: any; at: number }
export interface RequestBreakdown {
  totalBytes: number; systemChars: number; toolCount: number; toolsBytes: number; messagesBytes: number
  est: { system: number; tools: number; messages: number; total: number }
}

const bytes = (x: unknown) => x === undefined ? 0 : new TextEncoder().encode(JSON.stringify(x)).length

/** what a chat request actually carries: system prompt, tool definitions and messages (local token estimate) */
export function describeRequest(body: any): RequestBreakdown {
  let system = ''
  let messages: any[] = []
  if (Array.isArray(body?.messages)) {
    messages = body.messages.filter((m: any) => m.role !== 'system')
    system = [typeof body.system === 'string' ? body.system : '', ...body.messages.filter((m: any) => m.role === 'system').map((m: any) => String(m.content || ''))].filter(Boolean).join('\n')
  } else if (Array.isArray(body?.contents)) {
    messages = body.contents
    system = (body.systemInstruction?.parts || []).map((p: any) => p.text || '').join('\n')
  }
  const tools = body?.tools
  const toolCount = Array.isArray(tools) ? tools.reduce((n: number, t: any) => n + (Array.isArray(t.functionDeclarations) ? t.functionDeclarations.length : 1), 0) : 0
  const toolsBytes = bytes(tools)
  const messagesBytes = bytes(messages)
  const est = { system: estimateTokens(system), tools: toolsBytes ? estimateTokens(JSON.stringify(tools)) : 0, messages: estimateTokens(messages.map(m => JSON.stringify(m.content ?? m.parts ?? '')).join(' ')) + messages.length * 4, total: 0 }
  est.total = est.system + est.tools + est.messages
  return { totalBytes: bytes(body), systemChars: system.length, toolCount, toolsBytes, messagesBytes, est }
}

const SECRET_HEADER = /^(authorization|x-api-key|x-goog-api-key|api-key|x-subscription-token|ocp-apim-subscription-key)$/i
/** redacted copy of a request for error details: parameters and structure stay, every text / image / key is replaced
 *  by a placeholder with its length (so it can be pasted into an issue without leaking the conversation or keys) */
export function summarizeRequest(req: { url: string; headers?: Record<string, string>; body?: any }): any {
  const red = (v: any, k = ''): any => {
    if (typeof v === 'string') {
      if (/^data:[^;]+;base64,/.test(v) || (k === 'data' && v.length > 200)) return `<binary ${v.length} chars>`
      if (['model', 'type', 'role', 'name', 'display', 'media_type', 'stop_reason', 'reasoning_effort', 'tool_choice', 'id', 'tool_use_id', 'tool_call_id', 'mime_type'].includes(k)) return v
      if (k === 'signature') return `<signature ${v.length} chars>`
      return `<text ${v.length} chars>`
    }
    if (Array.isArray(v)) return v.map(x => red(x, k))
    if (v && typeof v === 'object') {
      if (k === 'input_schema' || k === 'parameters') return '<schema>'
      return Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, red(x, kk)]))
    }
    return v
  }
  let url = req.url
  try { const u = new URL(req.url); for (const k of [...u.searchParams.keys()]) if (/key|token|secret/i.test(k)) u.searchParams.set(k, '***'); url = u.toString() } catch { /* keep */ }
  const headers = Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k, SECRET_HEADER.test(k) ? '***' : v]))
  return { method: 'POST', url, headers, body: red(req.body) }
}
