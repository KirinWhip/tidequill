import { describe, it, expect } from 'vitest'
import { buildRequest, streamChat, createAccumulator, toAnthropicMessages, listModels } from '../src/shared/providers'
import type { Message, ProviderConfig } from '../src/shared/types'

const P = (type: any, extra: Partial<ProviderConfig> = {}): ProviderConfig => ({ id: type, name: type, type, apiKey: 'k', baseURL: '', models: [], ...extra })
const msgs: Message[] = [{ id: '1', role: 'user', content: 'hi', images: ['data:image/png;base64,AAAA'], attachments: [{ name: 'a.txt', text: 'file' }], createdAt: 0 }]
const opts = { model: 'm', temperature: 0.5, maxTokens: 100, tools: [{ name: 't', description: 'd', parameters: { type: 'object', properties: {} } }] }

function sseResponse(events: string[]) {
  const enc = new TextEncoder()
  const body = new ReadableStream({ start(c) { for (const e of events) c.enqueue(enc.encode(`data: ${e}\n\n`)); c.close() } })
  return new Response(body, { status: 200 })
}

describe('request builders', () => {
  it('openai', () => {
    const r = buildRequest(P('openai', { baseURL: 'https://api.deepseek.com/v1/' }), 'sys', msgs, opts)
    expect(r.url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(r.headers.Authorization).toBe('Bearer k')
    expect(r.body.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(r.body.messages[1].content[1].image_url.url).toContain('data:image/png')
    expect(r.body.messages[1].content[0].text).toContain('<file name="a.txt">')
    expect(r.body.tools[0].function.name).toBe('t')
  })
  it('ollama uses /v1', () => {
    expect(buildRequest(P('ollama', { apiKey: '' }), '', msgs, opts).url).toBe('http://localhost:11434/v1/chat/completions')
  })
  it('anthropic', () => {
    const r = buildRequest(P('anthropic'), 'sys', msgs, opts)
    expect(r.url).toBe('https://api.anthropic.com/v1/messages')
    expect(r.headers['x-api-key']).toBe('k')
    expect(r.body.system).toBe('sys')
    expect(r.body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } })
    expect(r.body.tools[0].input_schema).toBeTruthy()
  })
  it('anthropic merges tool results into user turn', () => {
    const m = toAnthropicMessages([
      { id: 'a', role: 'user', content: 'q', createdAt: 0 },
      { id: 'b', role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't', args: { x: 1 } }], createdAt: 0 },
      { id: 'c', role: 'tool', toolCallId: 'c1', content: 'r', createdAt: 0 },
    ])
    expect(m).toHaveLength(3)
    expect(m[1].content[0].type).toBe('tool_use')
    expect(m[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 'c1', content: 'r' })
  })
  it('gemini', () => {
    const r = buildRequest(P('gemini'), 'sys', msgs, opts)
    expect(r.url).toContain('/v1beta/models/m:streamGenerateContent?alt=sse&key=k')
    expect(r.body.systemInstruction.parts[0].text).toBe('sys')
    expect(r.body.contents[0].parts[1].inline_data.data).toBe('AAAA')
  })
})

describe('reasoning / deep thinking', () => {
  const r = { ...opts, reasoning: true, tools: undefined }
  it('openai sends reasoning_effort, deepseek does not', () => {
    expect(buildRequest(P('openai'), '', msgs, r).body.reasoning_effort).toBe('high')
    expect(buildRequest(P('openai'), '', msgs, { ...r, model: 'deepseek-reasoner' }).body.reasoning_effort).toBeUndefined()
    expect(buildRequest(P('openai'), '', msgs, opts).body.reasoning_effort).toBeUndefined()
  })
  it('anthropic enables extended thinking without temperature', () => {
    const b = buildRequest(P('anthropic'), '', msgs, { ...r, model: 'claude-3-7-sonnet-latest' }).body
    expect(b.thinking.type).toBe('enabled'); expect(b.temperature).toBeUndefined()
    expect(b.max_tokens).toBeGreaterThan(b.thinking.budget_tokens)
  })
  it('gemini includes thoughts', () => {
    expect(buildRequest(P('gemini'), '', msgs, { ...r, model: 'gemini-2.5-flash' }).body.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: -1 })
    expect(buildRequest(P('gemini'), '', msgs, { ...r, model: 'gemini-3-pro-preview' }).body.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: 'high' })
    expect(buildRequest(P('gemini'), '', msgs, opts).body.generationConfig.thinkingConfig).toBeUndefined()
  })
  it('deepseek official: thinking enabled/disabled per docs', () => {
    const ds = { ...P('openai'), baseURL: 'https://api.deepseek.com' }
    expect(buildRequest(ds, '', msgs, { ...r, model: 'deepseek-flash' }).body).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'high' })
    const off = buildRequest(ds, '', msgs, { ...opts, tools: undefined, model: 'deepseek-flash' }).body
    expect(off.thinking).toEqual({ type: 'disabled' }); expect(off.reasoning_effort).toBeUndefined()
  })
  it('deepseek passes reasoning_content back only when tools are present', () => {
    const ds = { ...P('openai'), baseURL: 'https://api.deepseek.com' }
    const hist: any[] = [{ id: 'u', role: 'user', content: 'q', createdAt: 0 }, { id: 'a', role: 'assistant', content: 'x', reasoning: 'R', createdAt: 0 }, { id: 'u2', role: 'user', content: 'q2', createdAt: 0 }]
    const withTools = buildRequest(ds, '', hist, { ...r, model: 'deepseek-flash', tools: [{ name: 't', description: 'd', parameters: { type: 'object', properties: {} } }] as any }).body
    expect(withTools.messages[1].reasoning_content).toBe('R')
    expect(buildRequest(ds, '', hist, { ...r, model: 'deepseek-flash' }).body.messages[1].reasoning_content).toBeUndefined()
  })
  it('ollama uses reasoning_effort on /v1 (not think)', () => {
    expect(buildRequest(P('ollama'), '', msgs, r).body).toMatchObject({ reasoning_effort: 'high' })
    expect(buildRequest(P('ollama'), '', msgs, r).body.think).toBeUndefined()
    expect(buildRequest(P('ollama'), '', msgs, opts).body.reasoning_effort).toBe('none')
  })
  it('claude 4.6+/5.x use adaptive thinking with summarized display', () => {
    const b = buildRequest(P('anthropic'), '', msgs, { ...r, model: 'claude-opus-4-7' }).body
    expect(b.thinking).toEqual({ type: 'adaptive', display: 'summarized' }); expect(b.temperature).toBeUndefined()
    expect(buildRequest(P('anthropic'), '', msgs, { ...r, model: 'claude-sonnet-4-5' }).body.thinking.type).toBe('enabled')
  })
  it('collects reasoning from openai/deepseek, anthropic and gemini streams', () => {
    const a = createAccumulator('openai')
    a.feed(JSON.stringify({ choices: [{ delta: { reasoning_content: 'think ' } }] })); a.feed(JSON.stringify({ choices: [{ delta: { content: 'ans' } }] }))
    expect(a.result()).toMatchObject({ text: 'ans', reasoning: 'think ' })
    const b = createAccumulator('anthropic')
    b.feed(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }))
    expect(b.result().reasoning).toBe('hmm')
    const g = createAccumulator('gemini')
    g.feed(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'idea', thought: true }, { text: 'out' }] } }] }))
    expect(g.result()).toMatchObject({ text: 'out', reasoning: 'idea' })
  })
  it('streams reasoning via onReasoning callback', async () => {
    const got: string[] = []
    const res = await streamChat(P('openai'), '', msgs, { ...r, onReasoning: x => got.push(x), fetchImpl: async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { reasoning_content: 'a' } }] }), JSON.stringify({ choices: [{ delta: { reasoning_content: 'b' } }] }), JSON.stringify({ choices: [{ delta: { content: 'c' } }] }), '[DONE]'])
    })
    expect(got).toEqual(['a', 'b']); expect(res.reasoning).toBe('ab'); expect(res.text).toBe('c')
  })
})

describe('stream parsing', () => {
  it('openai text + tool calls', async () => {
    const deltas: string[] = []
    const res = await streamChat(P('openai'), '', msgs, {
      ...opts, onDelta: d => deltas.push(d),
      fetchImpl: async () => sseResponse([
        JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'calc', arguments: '{"a":' } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }] }),
        '[DONE]',
      ]),
    })
    expect(deltas.join('')).toBe('Hello')
    expect(res.text).toBe('Hello')
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'calc', args: { a: 1 } }])
  })
  it('anthropic events', async () => {
    const res = await streamChat(P('anthropic'), '', msgs, {
      ...opts, fetchImpl: async () => sseResponse([
        JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } }),
        JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu', name: 'x' } }),
        JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":"a"}' } }),
        JSON.stringify({ type: 'message_stop' }),
      ]),
    })
    expect(res).toEqual({ text: '你好', toolCalls: [{ id: 'tu', name: 'x', args: { q: 'a' } }] })
  })
  it('gemini chunks', () => {
    const a = createAccumulator('gemini')
    a.feed(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'a' }] } }] }))
    a.feed(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'b' }, { functionCall: { name: 'f', args: { z: 1 } } }] } }] }))
    const r = a.result()
    expect(r.text).toBe('ab'); expect(r.toolCalls[0].name).toBe('f'); expect(r.toolCalls[0].args).toEqual({ z: 1 })
  })
  it('handles chunk split across reads', async () => {
    const enc = new TextEncoder()
    const s = `data: ${JSON.stringify({ choices: [{ delta: { content: 'xyz' } }] })}\n\ndata: [DONE]\n\n`
    const body = new ReadableStream({ start(c) { c.enqueue(enc.encode(s.slice(0, 15))); c.enqueue(enc.encode(s.slice(15))); c.close() } })
    const r = await streamChat(P('openai'), '', msgs, { ...opts, fetchImpl: async () => new Response(body) })
    expect(r.text).toBe('xyz')
  })
  it('throws on HTTP error', async () => {
    await expect(streamChat(P('openai'), '', msgs, { ...opts, fetchImpl: async () => new Response('bad key', { status: 401 }) })).rejects.toThrow('HTTP 401')
  })
  it('lists ollama models', async () => {
    const m = await listModels(P('ollama'), (async () => new Response(JSON.stringify({ models: [{ name: 'llama3' }] }))) as any)
    expect(m).toEqual(['llama3'])
  })
})
