import type { Message, ProviderConfig, ToolCall, ToolDef } from './types'
import { ProviderError, codeForStatus, errorDetail, toProviderError } from './errors'

export interface ChatOptions {
  model: string
  temperature: number
  maxTokens: number
  tools?: ToolDef[]
  signal?: AbortSignal
  onDelta?: (text: string) => void
  /** deep thinking / reasoning mode */
  reasoning?: boolean
  onReasoning?: (text: string) => void
  fetchImpl?: typeof fetch
}

export interface ChatResult {
  text: string
  reasoning?: string
  toolCalls: ToolCall[]
}

export interface HttpRequest {
  url: string
  headers: Record<string, string>
  body: any
}

const trim = (u: string) => u.replace(/\/+$/, '')

export function defaultBaseURL(type: ProviderConfig['type']): string {
  switch (type) {
    case 'openai': return 'https://api.openai.com/v1'
    case 'anthropic': return 'https://api.anthropic.com'
    case 'gemini': return 'https://generativelanguage.googleapis.com'
    case 'ollama': return 'http://localhost:11434'
  }
}

function userText(m: Message): string {
  let t = m.content
  if (m.attachments?.length) {
    t += '\n\n' + m.attachments.map(a => `<file name="${a.name}">\n${a.text}\n</file>`).join('\n')
  }
  return t
}

function parseDataURL(d: string): { mime: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(d)
  return m ? { mime: m[1], data: m[2] } : { mime: 'image/png', data: d }
}

// ---------- OpenAI compatible (also used for Ollama via /v1) ----------
export function toOpenAIMessages(system: string, msgs: Message[]): any[] {
  const out: any[] = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of msgs) {
    if (m.role === 'system') continue
    if (m.role === 'tool') { out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content }); continue }
    if (m.role === 'assistant') {
      const a: any = { role: 'assistant', content: m.content || null }
      if (m.toolCalls?.length) a.tool_calls = m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }))
      out.push(a); continue
    }
    if (m.images?.length) {
      out.push({ role: 'user', content: [{ type: 'text', text: userText(m) }, ...m.images.map(u => ({ type: 'image_url', image_url: { url: u } }))] })
    } else out.push({ role: 'user', content: userText(m) })
  }
  return out
}

export function buildOpenAIRequest(p: ProviderConfig, system: string, msgs: Message[], o: ChatOptions): HttpRequest {
  const base = p.type === 'ollama' ? trim(p.baseURL || defaultBaseURL('ollama')) + '/v1' : trim(p.baseURL || defaultBaseURL('openai'))
  const body: any = { model: o.model, messages: toOpenAIMessages(system, msgs), stream: true, temperature: o.temperature }
  if (o.maxTokens) body.max_tokens = o.maxTokens
  // reasoning models (o-series, gpt-5, grok-3-mini, qwen3...) accept reasoning_effort; DeepSeek-reasoner reasons by model choice
  if (o.reasoning && p.type !== 'ollama' && !/deepseek/i.test(o.model)) body.reasoning_effort = 'high'
  if (o.reasoning && p.type === 'ollama') body.think = true
  if (o.tools?.length) body.tools = o.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`
  return { url: base + '/chat/completions', headers, body }
}

// ---------- Anthropic ----------
export function toAnthropicMessages(msgs: Message[]): any[] {
  const out: any[] = []
  const push = (role: string, block: any) => {
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(block)
    else out.push({ role, content: [block] })
  }
  for (const m of msgs) {
    if (m.role === 'system') continue
    if (m.role === 'tool') { push('user', { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }); continue }
    if (m.role === 'assistant') {
      if (m.content) push('assistant', { type: 'text', text: m.content })
      for (const c of m.toolCalls || []) push('assistant', { type: 'tool_use', id: c.id, name: c.name, input: c.args })
      continue
    }
    for (const img of m.images || []) {
      const { mime, data } = parseDataURL(img)
      push('user', { type: 'image', source: { type: 'base64', media_type: mime, data } })
    }
    push('user', { type: 'text', text: userText(m) || ' ' })
  }
  return out
}

export function buildAnthropicRequest(p: ProviderConfig, system: string, msgs: Message[], o: ChatOptions): HttpRequest {
  const body: any = { model: o.model, messages: toAnthropicMessages(msgs), stream: true, temperature: Math.min(o.temperature, 1), max_tokens: o.maxTokens || 4096 }
  if (system) body.system = system
  if (o.reasoning) {
    // extended thinking: temperature must be omitted and max_tokens > budget
    const budget = Math.max(1024, Math.min(8192, Math.floor((o.maxTokens || 4096) / 2)))
    body.thinking = { type: 'enabled', budget_tokens: budget }
    body.max_tokens = Math.max(body.max_tokens, budget + 1024)
    delete body.temperature
  }
  if (o.tools?.length) body.tools = o.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  return {
    url: trim(p.baseURL || defaultBaseURL('anthropic')) + '/v1/messages',
    headers: { 'Content-Type': 'application/json', 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' },
    body,
  }
}

// ---------- Gemini ----------
export function toGeminiContents(msgs: Message[]): any[] {
  const out: any[] = []
  for (const m of msgs) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      out.push({ role: 'user', parts: [{ functionResponse: { name: m.toolCallId?.split('::')[0] || 'tool', response: { result: m.content } } }] })
      continue
    }
    if (m.role === 'assistant') {
      const parts: any[] = []
      if (m.content) parts.push({ text: m.content })
      for (const c of m.toolCalls || []) parts.push({ functionCall: { name: c.name, args: c.args } })
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: ' ' }] })
      continue
    }
    const parts: any[] = [{ text: userText(m) || ' ' }]
    for (const img of m.images || []) { const { mime, data } = parseDataURL(img); parts.push({ inline_data: { mime_type: mime, data } }) }
    out.push({ role: 'user', parts })
  }
  return out
}

export function buildGeminiRequest(p: ProviderConfig, system: string, msgs: Message[], o: ChatOptions): HttpRequest {
  const body: any = { contents: toGeminiContents(msgs), generationConfig: { temperature: o.temperature, maxOutputTokens: o.maxTokens || undefined } }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  if (o.reasoning) body.generationConfig.thinkingConfig = { includeThoughts: true }
  if (o.tools?.length) body.tools = [{ functionDeclarations: o.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
  return {
    url: `${trim(p.baseURL || defaultBaseURL('gemini'))}/v1beta/models/${encodeURIComponent(o.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(p.apiKey)}`,
    headers: { 'Content-Type': 'application/json' },
    body,
  }
}

export function buildRequest(p: ProviderConfig, system: string, msgs: Message[], o: ChatOptions): HttpRequest {
  if (p.type === 'anthropic') return buildAnthropicRequest(p, system, msgs, o)
  if (p.type === 'gemini') return buildGeminiRequest(p, system, msgs, o)
  return buildOpenAIRequest(p, system, msgs, o)
}

// ---------- SSE parsing ----------
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '')
      const data = chunk.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n')
      if (data) yield data
    }
  }
  const rest = buf.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n')
  if (rest) yield rest
}

export function createAccumulator(type: ProviderConfig['type']) {
  let text = ''
  let reasoning = ''
  let rDelta = ''
  const calls = new Map<number | string, { id: string; name: string; argsText: string; args?: any }>()
  let n = 0
  return {
    /** feed one SSE data payload; returns new text delta */
    feed(data: string): string {
      if (data === '[DONE]') return ''
      let j: any
      try { j = JSON.parse(data) } catch { return '' }
      let delta = ''
      rDelta = ''
      if (type === 'anthropic') {
        if (j.type === 'content_block_start' && j.content_block?.type === 'tool_use') calls.set(j.index, { id: j.content_block.id, name: j.content_block.name, argsText: '' })
        if (j.type === 'content_block_delta') {
          if (j.delta?.type === 'text_delta') delta = j.delta.text
          if (j.delta?.type === 'thinking_delta') rDelta = j.delta.thinking || ''
          if (j.delta?.type === 'input_json_delta') { const c = calls.get(j.index); if (c) c.argsText += j.delta.partial_json }
        }
        if (j.type === 'error') throw new Error(j.error?.message || 'Anthropic error')
      } else if (type === 'gemini') {
        for (const part of j.candidates?.[0]?.content?.parts || []) {
          if (part.text && part.thought) rDelta += part.text
          else if (part.text) delta += part.text
          if (part.functionCall) calls.set(n++, { id: `${part.functionCall.name}::${n}`, name: part.functionCall.name, argsText: '', args: part.functionCall.args || {} })
        }
        if (j.error) throw new Error(j.error.message)
      } else {
        const d = j.choices?.[0]?.delta
        if (d?.content) delta = d.content
        if (d?.reasoning_content) rDelta = d.reasoning_content
        else if (typeof d?.reasoning === 'string') rDelta = d.reasoning
        for (const tc of d?.tool_calls || []) {
          const k = tc.index ?? 0
          const c = calls.get(k) || { id: tc.id || `call_${k}`, name: '', argsText: '' }
          if (tc.id) c.id = tc.id
          if (tc.function?.name) c.name += tc.function.name
          if (tc.function?.arguments) c.argsText += tc.function.arguments
          calls.set(k, c)
        }
        if (j.error) throw new Error(j.error.message || 'API error')
      }
      text += delta
      reasoning += rDelta
      return delta
    },
    /** reasoning text produced by the last feed() call */
    lastReasoning(): string { return rDelta },
    result(): ChatResult {
      const toolCalls: ToolCall[] = [...calls.values()].map(c => {
        let args = c.args
        if (!args) { try { args = c.argsText ? JSON.parse(c.argsText) : {} } catch { args = {} } }
        return { id: c.id, name: c.name, args }
      })
      return reasoning ? { text, reasoning, toolCalls } : { text, toolCalls }
    },
  }
}

export async function streamChat(p: ProviderConfig, system: string, msgs: Message[], o: ChatOptions): Promise<ChatResult> {
  const req = buildRequest(p, system, msgs, o)
  const f = o.fetchImpl || fetch
  let res: Response
  try {
    res = await f(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: o.signal })
  } catch (e: any) {
    if (e?.name === 'AbortError') return { text: '', toolCalls: [] }
    throw toProviderError(e, 'connect')
  }
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    throw new ProviderError(codeForStatus(res.status), errorDetail(t), res.status)
  }
  const acc = createAccumulator(p.type)
  try {
    for await (const data of sseEvents(res.body)) {
      const d = acc.feed(data)
      const r = acc.lastReasoning()
      if (r) o.onReasoning?.(r)
      if (d) o.onDelta?.(d)
    }
  } catch (e: any) {
    if (e?.name === 'AbortError' || o.signal?.aborted) return acc.result()
    const pe = toProviderError(e, 'stream')
    ;(pe as any).partial = acc.result()
    throw pe
  }
  return acc.result()
}

async function getJSON(f: typeof fetch, url: string, init?: RequestInit) {
  let r: Response
  try { r = await f(url, init) } catch (e) { throw toProviderError(e, 'connect') }
  const t = await r.text()
  if (!r.ok) throw new ProviderError(codeForStatus(r.status), errorDetail(t), r.status)
  try { return JSON.parse(t) } catch { throw new ProviderError('http', t.slice(0, 200)) }
}

export async function listModels(p: ProviderConfig, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  if (p.type === 'ollama') {
    const j = await getJSON(fetchImpl, trim(p.baseURL || defaultBaseURL('ollama')) + '/api/tags'); return (j.models || []).map((m: any) => m.name)
  }
  if (p.type === 'gemini') {
    const j = await getJSON(fetchImpl, `${trim(p.baseURL || defaultBaseURL('gemini'))}/v1beta/models?key=${encodeURIComponent(p.apiKey)}`); return (j.models || []).map((m: any) => String(m.name).replace('models/', ''))
  }
  if (p.type === 'anthropic') {
    const j = await getJSON(fetchImpl, trim(p.baseURL || defaultBaseURL('anthropic')) + '/v1/models', { headers: { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' } }); return (j.data || []).map((m: any) => m.id)
  }
  const j = await getJSON(fetchImpl, trim(p.baseURL || defaultBaseURL('openai')) + '/models', { headers: { Authorization: `Bearer ${p.apiKey}` } })
  return (j.data || []).map((m: any) => m.id).sort()
}

export async function generateImage(p: ProviderConfig, prompt: string, model: string, size = '1024x1024', fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const j = await getJSON(fetchImpl, trim(p.baseURL || defaultBaseURL('openai')) + '/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({ model, prompt, n: 1, size }),
  })
  return (j.data || []).map((d: any) => d.b64_json ? `data:image/png;base64,${d.b64_json}` : d.url)
}
