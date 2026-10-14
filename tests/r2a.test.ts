import { describe, it, expect } from 'vitest'
import { buildRequest, cleanTitle, summarizeTitle } from '../src/shared/providers'
import { describeRequest } from '../src/shared/reqdebug'
import { defaultSettings } from '../src/shared/storage'
import type { Message, ProviderConfig } from '../src/shared/types'

const P: ProviderConfig = { id: 'd', name: 'd', type: 'openai', apiKey: 'k', baseURL: 'https://api.deepseek.com', models: [] }
const Q = '你好 你是谁 你能干啥?'
const msgs: Message[] = [{ id: '1', role: 'user', content: Q, createdAt: 0 }]
const TOOLS = [
  { name: 'builtin__get_current_time', description: 'Get the current local date and time', parameters: { type: 'object', properties: {} } },
  { name: 'builtin__calculator', description: 'Evaluate a math expression', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } },
]

describe('A2 request content', () => {
  it('defaults: builtin tools off, auto title on', () => {
    const s = defaultSettings() as any
    expect(s.builtinTools).toBe(false); expect(s.autoTitle).toBe(true)
  })
  it('describeRequest breaks a request into system / tools / messages', () => {
    const without = describeRequest(buildRequest(P, '', msgs, { model: 'deepseek-flash', temperature: 0.7, maxTokens: 512 }).body)
    expect(without).toMatchObject({ systemChars: 0, toolCount: 0, toolsBytes: 0 })
    expect(without.est.total).toBeLessThan(30)
    const withTools = describeRequest(buildRequest(P, 'sys prompt', msgs, { model: 'deepseek-flash', temperature: 0.7, maxTokens: 512, tools: TOOLS }).body)
    expect(withTools.toolCount).toBe(2); expect(withTools.toolsBytes).toBeGreaterThan(200); expect(withTools.systemChars).toBe(10)
  })
  it('handles anthropic and gemini bodies', () => {
    const a = describeRequest(buildRequest({ ...P, type: 'anthropic' }, 'abc', msgs, { model: 'claude-x', temperature: 1, maxTokens: 100, tools: TOOLS }).body)
    expect(a).toMatchObject({ systemChars: 3, toolCount: 2 })
    const g = describeRequest(buildRequest({ ...P, type: 'gemini' }, 'abcd', msgs, { model: 'gemini-2.5-flash', temperature: 1, maxTokens: 100, tools: TOOLS }).body)
    expect(g).toMatchObject({ systemChars: 4, toolCount: 2 })
  })
})

describe('A7 auto title', () => {
  it('cleans model output to a short title', () => {
    expect(cleanTitle('「周末杭州行程规划」')).toBe('周末杭州行程规划')
    expect(cleanTitle('标题：这是一个非常非常长的中文标题超过十个字')).toHaveLength(10)
    expect(cleanTitle('"Weekend trip plan."\nextra')).toBe('Weekend trip plan')
    expect(cleanTitle('<think>x</think>\n短标题')).toBe('短标题')
  })
  it('sends one short request without tools and with thinking disabled', async () => {
    let body: any
    const enc = new TextEncoder()
    const fetchImpl: any = async (_u: string, init: any) => {
      body = JSON.parse(init.body)
      return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"杭州周末游"}}]}\n\ndata: [DONE]\n\n')); c.close() } }), { status: 200 })
    }
    expect(await summarizeTitle(P, 'deepseek-flash', '帮我规划周末去杭州', '好的……', '请为下面这段对话起一个标题', fetchImpl)).toBe('杭州周末游')
    expect(body.tools).toBeUndefined(); expect(body.max_tokens).toBe(120); expect(body.thinking).toEqual({ type: 'disabled' })
  })
})
