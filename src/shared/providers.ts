import type { Message, ProviderConfig, ToolCall, ToolDef } from './types'
import { ProviderError, classifyError, errorDetail, toProviderError } from './errors'
import { summarizeRequest } from './reqdebug'

export interface ChatOptions {
  model: string
  temperature: number
  topP?: number
  maxTokens: number
  tools?: ToolDef[]
  signal?: AbortSignal
  onDelta?: (text: string) => void
  /** deep thinking / reasoning mode */
  reasoning?: boolean
  onReasoning?: (text: string) => void
  fetchImpl?: typeof fetch
  /** debug hook: the exact request (url with secrets redacted + JSON body), headers are never exposed */
  onRequest?: (r: { url: string; body: any }) => void
}

export interface Usage { input: number; output: number; estimated?: boolean }
export interface ChatResult {
  text: string
  /** Anthropic: thinking blocks with signatures (sent back in tool-use turns) */
  thinkingBlocks?: import('./types').ThinkingBlock[]
  usage?: Usage
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
  let t = m.quote ? m.quote.split('\n').map(l => '> ' + l).join('\n') + '\n\n' + m.content : m.content
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
export function toOpenAIMessages(system: string, msgs: Message[], passReasoning = false, wire: (n: string) => string = n => n): any[] {
  const out: any[] = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of msgs) {
    if (m.role === 'system') continue
    if (m.role === 'tool') { out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content }); continue }
    if (m.role === 'assistant') {
      const a: any = { role: 'assistant', content: m.content || null }
      // DeepSeek thinking mode + tools: reasoning_content of earlier turns must be passed back (else HTTP 400)
      if (passReasoning && m.reasoning) a.reasoning_content = m.reasoning
      if (m.toolCalls?.length) a.tool_calls = m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: wire(c.name), arguments: JSON.stringify(c.args) } }))
      out.push(a); continue
    }
    if (m.images?.length) {
      out.push({ role: 'user', content: [{ type: 'text', text: userText(m) }, ...m.images.map(u => ({ type: 'image_url', image_url: { url: u } }))] })
    } else out.push({ role: 'user', content: userText(m) })
  }
  return out
}

/** DeepSeek official API (https://api-docs.deepseek.com/guides/thinking_mode) */
export const isDeepSeekOfficial = (p: ProviderConfig) => /(^|\/\/)api\.deepseek\.com/i.test(p.baseURL || '')

/** deep-thinking request params for OpenAI-compatible endpoints, per provider docs:
 *  - DeepSeek official: thinking mode is ON by default -> {"thinking":{"type":"enabled"|"disabled"}} + reasoning_effort when enabled
 *  - Ollama /v1 (OpenAI compat): reasoning_effort "high" | "none" (native `think` is NOT accepted on /v1)
 *  - DeepSeek models on third-party hosts: no extra params (host-specific, unknown)
 *  - others (OpenAI o-series / gpt-5, xAI, ...): reasoning_effort "high" only when the toggle is on */
export function openAIReasoningParams(p: ProviderConfig, o: Pick<ChatOptions, 'reasoning' | 'model'>): Record<string, any> {
  if (p.type === 'ollama') return { reasoning_effort: o.reasoning ? 'high' : 'none' }
  if (isDeepSeekOfficial(p)) return o.reasoning ? { thinking: { type: 'enabled' }, reasoning_effort: 'high' } : { thinking: { type: 'disabled' } }
  if (/deepseek/i.test(o.model)) return {}
  return o.reasoning ? { reasoning_effort: 'high' } : {}
}

export function buildOpenAIRequest(p: ProviderConfig, system: string, msgs: Message[], o: ChatOptions): HttpRequest {
  const base = p.type === 'ollama' ? trim(p.baseURL || defaultBaseURL('ollama')) + '/v1' : trim(p.baseURL || defaultBaseURL('openai'))
  const body: any = { model: o.model, messages: toOpenAIMessages(system, msgs, isDeepSeekOfficial(p) && !!o.tools?.length, toolNameMap(o.tools).wire), stream: true, temperature: o.temperature }
  if (o.maxTokens) body.max_tokens = o.maxTokens
  if (o.topP != null && o.topP < 1) body.top_p = o.topP
  if (p.type === 'openai') body.stream_options = { include_usage: true }
  Object.assign(body, openAIReasoningParams(p, o))
  const names = toolNameMap(o.tools)
  if (o.tools?.length) body.tools = o.tools.map(t => ({ type: 'function', function: { name: names.wire(t.name), description: t.description, parameters: objectSchema(t.parameters) } }))
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`
  return { url: base + '/chat/completions', headers, body }
}

// ---------- Anthropic ----------
export function toAnthropicMessages(msgs: Message[], wire: (n: string) => string = n => n): any[] {
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
      // thinking blocks go back unchanged (signature) and first, required when the turn called tools with thinking on
      if (m.toolCalls?.length) for (const b of m.thinkingBlocks || []) push('assistant', b.type === 'redacted_thinking' ? { type: 'redacted_thinking', data: b.data } : { type: 'thinking', thinking: b.thinking || '', signature: b.signature || '' })
      if (m.content.trim()) push('assistant', { type: 'text', text: m.content })
      for (const c of m.toolCalls || []) push('assistant', { type: 'tool_use', id: c.id, name: wire(c.name), input: c.args })
      continue
    }
    for (const img of m.images || []) {
      const { mime, data } = parseDataURL(img)
      push('user', { type: 'image', source: { type: 'base64', media_type: mime, data } })
    }
    // text blocks must contain non-whitespace text (400 otherwise); an image-only message needs no text block
    const ut = userText(m)
    if (ut.trim()) push('user', { type: 'text', text: ut })
    else if (!m.images?.length) push('user', { type: 'text', text: '.' })
  }
  return out
}

/** Claude model capabilities, from https://platform.claude.com/docs/en/build-with-claude/thinking (per-model table) and
 *  thinking-troubleshooting: e.g. claude-sonnet-5-5 -> 5.5, claude-opus-4-7 -> 4.7, claude-sonnet-4-5-20250929 -> 4.5; older ids -> 0 */
export function claudeVersion(model: string): number {
  const x = /claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/i.exec(model)
  if (!x) return /mythos/i.test(model) ? 5 : 0
  return +x[1] + (x[2] && x[2].length <= 2 ? +x[2] / 10 : 0)
}
export function claudeCaps(model: string) {
  const v = claudeVersion(model), fam = (/claude-(opus|sonnet|haiku|fable|mythos)/i.exec(model) || [])[1]?.toLowerCase() || ''
  // how to turn thinking off on models where it is on by default (5.x): Sonnet 5.5 only accepts between_tools,
  // Haiku 5.5 / Opus 5 / Sonnet 5 accept disabled, the others cannot turn it off
  const offType: 'disabled' | 'between_tools' | null = v < 5 ? null : fam === 'sonnet' && v === 5.5 ? 'between_tools' : (fam === 'haiku' && v === 5.5) || (fam === 'opus' && v === 5) || (fam === 'sonnet' && v === 5) ? 'disabled' : null
  return {
    version: v,
    /** non-default temperature / top_p / top_k are rejected with 400 on every request (4.7+ and 5.x) */
    samplingLocked: v >= 4.7,
    /** temperature and top_p cannot both be sent (4.5 and later) */
    oneSampler: v >= 4.5,
    adaptive: v >= 4.6,
    /** "enabled" + budget_tokens is rejected with 400 on 4.7+ */
    enabledOk: v < 4.7,
    /** thinking is on when no thinking field is sent */
    defaultOn: v >= 5,
    offType,
  }
}
/** Claude models that only/also support adaptive thinking (4.6+, 5.x, Mythos) */
export const claudeAdaptive = (model: string) => claudeCaps(model).adaptive

/** tool names must match ^[a-zA-Z0-9_-]{1,64}$ (Anthropic and OpenAI); returns wire name <-> original name maps */
export function toolNameMap(tools?: ToolDef[]) {
  const toWire = new Map<string, string>(), fromWire = new Map<string, string>()
  for (const t of tools || []) {
    let w = t.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'tool'
    for (let i = 2; fromWire.has(w) && fromWire.get(w) !== t.name; i++) w = (w.slice(0, 60) + '_' + i)
    toWire.set(t.name, w); fromWire.set(w, t.name)
  }
  return { wire: (n: string) => toWire.get(n) || n, orig: (n: string) => fromWire.get(n) || n }
}
/** JSON schema for a tool's input: must be an object schema */
export const objectSchema = (p: any) => (p && typeof p === 'object' && p.type === 'object') ? p : { type: 'object', properties: {}, ...(p && typeof p === 'object' && !Array.isArray(p) ? p : {}), ...(p?.type && p.type !== 'object' ? { type: 'object' } : {}) }

export function buildAnthropicRequest(p: ProviderConfig, system: string, msgs: Message[], o: ChatOptions): HttpRequest {
  const caps = claudeCaps(o.model)
  const names = toolNameMap(o.tools)
  const body: any = { model: o.model, messages: toAnthropicMessages(msgs, names.wire), stream: true, max_tokens: o.maxTokens || 4096 }
  if (system) body.system = system
  let thinkingOn = false
  if (o.reasoning) {
    // https://platform.claude.com/docs/en/build-with-claude/thinking : 4.6+ / 5.x use adaptive thinking ("enabled" is a 400 on 4.7+);
    // display "summarized" so the thinking text is returned (the default is "omitted" on 4.7+ / 5.x).
    // Older models: extended thinking, budget_tokens >= 1024 and < max_tokens.
    if (caps.adaptive) body.thinking = { type: 'adaptive', display: 'summarized' }
    else {
      const budget = Math.max(1024, Math.min(8192, Math.floor((o.maxTokens || 4096) / 2)))
      body.thinking = { type: 'enabled', budget_tokens: budget }
      body.max_tokens = Math.max(body.max_tokens, budget + 1024)
    }
    thinkingOn = true
  } else if (caps.defaultOn) {
    // 5.x think by default: turn it off where the model allows it, otherwise it stays on (adaptive, thinking text omitted)
    if (caps.offType) body.thinking = { type: caps.offType }
    else thinkingOn = true
  }
  // sampling parameters (thinking-troubleshooting): 4.7+ / 5.x reject any non-default temperature / top_p / top_k;
  // with thinking on, temperature / top_k are incompatible; 4.5+ reject temperature together with top_p.
  if (!caps.samplingLocked && !thinkingOn) {
    const topP = o.topP != null && o.topP < 1 ? o.topP : undefined
    if (topP !== undefined) body.top_p = topP
    if (topP === undefined || !caps.oneSampler) body.temperature = Math.min(o.temperature, 1)
  }
  if (o.tools?.length) body.tools = o.tools.map(t => ({ name: names.wire(t.name), description: t.description, input_schema: objectSchema(t.parameters) }))
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
  const body: any = { contents: toGeminiContents(msgs), generationConfig: { temperature: o.temperature, maxOutputTokens: o.maxTokens || undefined, ...(o.topP != null && o.topP < 1 ? { topP: o.topP } : {}) } }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  // https://ai.google.dev/gemini-api/docs/thinking : Gemini 3+ use thinkingLevel, 2.5 uses thinkingBudget (-1 = dynamic);
  // includeThoughts returns thought summaries (parts with thought: true)
  if (o.reasoning) body.generationConfig.thinkingConfig = /gemini-(2\.|1\.)/i.test(o.model) ? { includeThoughts: true, thinkingBudget: -1 } : { includeThoughts: true, thinkingLevel: 'high' }
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
  let usage: Usage | undefined
  const calls = new Map<number | string, { id: string; name: string; argsText: string; args?: any }>()
  const thinking = new Map<number, import('./types').ThinkingBlock>()
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
        if (j.type === 'content_block_start' && j.content_block?.type === 'thinking') thinking.set(j.index, { type: 'thinking', thinking: j.content_block.thinking || '', signature: j.content_block.signature || '' })
        if (j.type === 'content_block_start' && j.content_block?.type === 'redacted_thinking') thinking.set(j.index, { type: 'redacted_thinking', data: j.content_block.data })
        if (j.type === 'content_block_delta' && j.delta?.type === 'signature_delta') { const b = thinking.get(j.index); if (b) b.signature = (b.signature || '') + j.delta.signature }
        if (j.type === 'content_block_delta' && j.delta?.type === 'thinking_delta') { const b = thinking.get(j.index); if (b) b.thinking = (b.thinking || '') + (j.delta.thinking || '') }
        if (j.type === 'content_block_delta') {
          if (j.delta?.type === 'text_delta') delta = j.delta.text
          if (j.delta?.type === 'thinking_delta') rDelta = j.delta.thinking || ''
          if (j.delta?.type === 'input_json_delta') { const c = calls.get(j.index); if (c) c.argsText += j.delta.partial_json }
        }
        if (j.type === 'message_start' && j.message?.usage) usage = { input: j.message.usage.input_tokens || 0, output: j.message.usage.output_tokens || 0 }
        if (j.type === 'message_delta' && j.usage) usage = { input: usage?.input || j.usage.input_tokens || 0, output: j.usage.output_tokens || 0 }
        if (j.type === 'error') throw new ProviderError(classifyError(0, JSON.stringify(j)), j.error?.message || 'Anthropic error')
      } else if (type === 'gemini') {
        for (const part of j.candidates?.[0]?.content?.parts || []) {
          if (part.text && part.thought) rDelta += part.text
          else if (part.text) delta += part.text
          if (part.functionCall) calls.set(n++, { id: `${part.functionCall.name}::${n}`, name: part.functionCall.name, argsText: '', args: part.functionCall.args || {} })
        }
        if (j.usageMetadata) usage = { input: j.usageMetadata.promptTokenCount || 0, output: (j.usageMetadata.candidatesTokenCount || 0) + (j.usageMetadata.thoughtsTokenCount || 0) }
        if (j.error) throw new ProviderError(classifyError(j.error.code || 0, JSON.stringify(j)), j.error.message)
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
        if (j.usage) usage = { input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0 }
        if (j.error) throw new ProviderError(classifyError(0, JSON.stringify(j)), j.error.message || 'API error')
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
      const r: ChatResult = { text, toolCalls }
      if (thinking.size) r.thinkingBlocks = [...thinking.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1])
      if (reasoning) r.reasoning = reasoning
      if (usage) r.usage = usage
      return r
    },
  }
}

export async function streamChat(p: ProviderConfig, system: string, msgs: Message[], o: ChatOptions): Promise<ChatResult> {
  const req = buildRequest(p, system, msgs, o)
  const f = o.fetchImpl || fetch
  o.onRequest?.({ url: req.url.replace(/([?&]key=)[^&]+/, '$1***'), body: req.body })
  let res: Response
  try {
    res = await f(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: o.signal })
  } catch (e: any) {
    if (e?.name === 'AbortError') return { text: '', toolCalls: [] }
    const pe = toProviderError(e, 'connect'); pe.request = summarizeRequest(req)
    throw pe
  }
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    const pe = new ProviderError(classifyError(res.status, t), errorDetail(t), res.status)
    pe.body = t.slice(0, 4000); pe.request = summarizeRequest(req)
    throw pe
  }
  const acc = createAccumulator(p.type)
  const names = toolNameMap(o.tools)
  const unwire = (r: ChatResult): ChatResult => ({ ...r, toolCalls: r.toolCalls.map(c => ({ ...c, name: names.orig(c.name) })) })
  try {
    for await (const data of sseEvents(res.body)) {
      const d = acc.feed(data)
      const r = acc.lastReasoning()
      if (r) o.onReasoning?.(r)
      if (d) o.onDelta?.(d)
    }
  } catch (e: any) {
    if (e?.name === 'AbortError' || o.signal?.aborted) return unwire(acc.result())
    const pe = toProviderError(e, 'stream')
    ;(pe as any).partial = unwire(acc.result())
    if (!pe.request) pe.request = summarizeRequest(req)
    throw pe
  }
  return unwire(acc.result())
}

async function getJSON(f: typeof fetch, url: string, init?: RequestInit) {
  let r: Response
  try { r = await f(url, init) } catch (e) { throw toProviderError(e, 'connect') }
  const t = await r.text()
  if (!r.ok) throw new ProviderError(classifyError(r.status, t), errorDetail(t), r.status)
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

/** clean a model-produced title: strip quotes / trailing punctuation, ≤10 chars for CJK, ≤40 otherwise */
export function cleanTitle(raw: string): string {
  let s = (raw || '').replace(/<think>[\s\S]*?<\/think>/g, '').split('\n').map(x => x.trim()).find(Boolean) || ''
  s = s.replace(/^(标题|title)\s*[:：]\s*/i, '').replace(/^["'“”‘’「『《【\s]+|["'“”‘’」』》】。.!！?？,，\s]+$/g, '').trim()
  return /[\u3400-\u9fff]/.test(s) ? [...s].slice(0, 10).join('') : s.slice(0, 40).trim()
}

/** one short, non-streaming-semantics request that summarizes a conversation title (auto title) */
export async function summarizeTitle(p: ProviderConfig, model: string, user: string, reply: string, prompt: string, fetchImpl?: typeof fetch): Promise<string> {
  const msg: Message = { id: 't', role: 'user', createdAt: 0, content: `${prompt}\n\n[User]\n${user.slice(0, 1000)}\n\n[Assistant]\n${reply.slice(0, 1000)}` }
  const res = await streamChat(p, '', [msg], { model, temperature: 0.3, maxTokens: 40, reasoning: false, fetchImpl })
  return cleanTitle(res.text)
}
