/** Round 3 · A5: Anthropic request builder vs. a strict mock of the documented API rules */
import { describe, it, expect } from 'vitest'
import { buildAnthropicRequest, claudeCaps, streamChat, toolNameMap } from '../src/shared/providers'
import { summarizeRequest } from '../src/shared/reqdebug'
import { ProviderError } from '../src/shared/errors'
import type { Message, ProviderConfig, ToolDef } from '../src/shared/types'
// @ts-ignore
import { validateAnthropic } from './mock-anthropic.mjs'
// @ts-ignore
import { startMockServer } from './mock-server.mjs'

const P: ProviderConfig = { id: 'a', name: 'Claude', type: 'anthropic', apiKey: 'sk-ant-secret-123', baseURL: 'http://x', models: [] }
const U = (content: string, extra: Partial<Message> = {}): Message => ({ id: 'u' + content.length, role: 'user', content, createdAt: 0, ...extra })
const TOOLS: ToolDef[] = [{ name: 'builtin__get_current_time', description: 't', parameters: { type: 'object', properties: {} } }, { name: 'srv.files/read', description: 'r', parameters: { properties: { p: { type: 'string' } } } as any }]
const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1', 'claude-3-7-sonnet-latest']

describe('A5: reproduction of the 1.0.1 first-message 400 on claude-sonnet-5-5', () => {
  it('the request 1.0.1 sent (deep thinking off: temperature 0.7, no thinking field) is rejected', () => {
    const v101 = { model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }], stream: true, temperature: 0.7, max_tokens: 4096 }
    expect(validateAnthropic(v101)).toMatch(/temperature.*deprecated/)
    // with deep thinking on 1.0.1 removed temperature, so the same question then succeeded
    const v101Thinking = { model: 'claude-sonnet-5-5', messages: v101.messages, stream: true, max_tokens: 4096, thinking: { type: 'adaptive', display: 'summarized' } }
    expect(validateAnthropic(v101Thinking)).toBe('')
  })
})

describe('A5: every builder output passes the strict validator', () => {
  for (const model of MODELS) for (const reasoning of [false, true]) for (const topP of [1, 0.9]) for (const tools of [undefined, TOOLS]) {
    it(`${model} reasoning=${reasoning} topP=${topP} tools=${!!tools}`, () => {
      const r = buildAnthropicRequest(P, 'sys', [U('你好')], { model, temperature: 0.7, topP, maxTokens: 4096, reasoning, tools })
      expect(validateAnthropic(r.body)).toBe('')
    })
  }
  it('small max_tokens with extended thinking still leaves room above the budget', () => {
    const r = buildAnthropicRequest(P, '', [U('x')], { model: 'claude-sonnet-4-5', temperature: 0.7, maxTokens: 600, reasoning: true })
    expect(r.body.max_tokens).toBeGreaterThan(r.body.thinking.budget_tokens); expect(validateAnthropic(r.body)).toBe('')
  })
  it('thinking defaults: Sonnet 5.5 off -> between_tools, Haiku 5.5 off -> disabled, Opus 5.5 cannot turn off', () => {
    const b = (model: string) => buildAnthropicRequest(P, '', [U('x')], { model, temperature: 0.7, maxTokens: 4096, reasoning: false }).body
    expect(b('claude-sonnet-5-5').thinking).toEqual({ type: 'between_tools' })
    expect(b('claude-haiku-5-5').thinking).toEqual({ type: 'disabled' })
    expect(b('claude-opus-5-5').thinking).toBeUndefined()
    expect(b('claude-opus-4-7').thinking).toBeUndefined()
    expect(b('claude-sonnet-4-5').temperature).toBe(0.7)
    expect(claudeCaps('claude-sonnet-5-5')).toMatchObject({ version: 5.5, samplingLocked: true, adaptive: true, enabledOk: false })
  })
  it('image-only message has no whitespace text block; tool names and schemas are normalized', () => {
    const img = 'data:image/png;base64,iVBORw0KGgo='
    const r = buildAnthropicRequest(P, '', [U('', { images: [img] })], { model: 'claude-sonnet-4-5', temperature: 0.7, maxTokens: 4096, tools: TOOLS })
    expect(r.body.messages[0].content.every((b: any) => b.type !== 'text')).toBe(true)
    expect(r.body.tools[1].name).toBe('srv_files_read'); expect(r.body.tools[1].input_schema.type).toBe('object')
    expect(toolNameMap(TOOLS).orig('srv_files_read')).toBe('srv.files/read')
    expect(validateAnthropic(r.body)).toBe('')
  })
  it('tool loop with thinking: the thinking block (signature) is sent back first', () => {
    const hist: Message[] = [U('调用工具'), { id: 'a1', role: 'assistant', content: '', createdAt: 0, toolCalls: [{ id: 'toolu_1', name: 'builtin__get_current_time', args: {} }], thinkingBlocks: [{ type: 'thinking', thinking: '', signature: 'sig-mock-1' }] },
      { id: 't1', role: 'tool', toolCallId: 'toolu_1', content: '12:00', createdAt: 0 }]
    const r = buildAnthropicRequest(P, '', hist, { model: 'claude-sonnet-5-5', temperature: 0.7, maxTokens: 4096, reasoning: true, tools: TOOLS })
    expect(r.body.messages[1].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-mock-1' })
    expect(validateAnthropic(r.body)).toBe('')
    const noSig = buildAnthropicRequest(P, '', hist.map(m => ({ ...m, thinkingBlocks: undefined })), { model: 'claude-sonnet-5-5', temperature: 0.7, maxTokens: 4096, reasoning: true, tools: TOOLS })
    expect(validateAnthropic(noSig.body)).toMatch(/Expected `thinking`/)
  })
})

describe('A5: error details carry the server body and a redacted request summary', () => {
  it('summary keeps parameters, hides text and keys', () => {
    const r = buildAnthropicRequest(P, '机密系统提示', [U('我的隐私问题')], { model: 'claude-sonnet-4-5', temperature: 0.7, maxTokens: 4096 })
    const s = summarizeRequest(r)
    const txt = JSON.stringify(s)
    expect(txt).not.toContain('sk-ant-secret-123'); expect(txt).not.toContain('我的隐私问题'); expect(txt).not.toContain('机密系统提示')
    expect(s.headers['x-api-key']).toBe('***'); expect(s.body.model).toBe('claude-sonnet-4-5'); expect(s.body.temperature).toBe(0.7); expect(s.body.max_tokens).toBe(4096)
    expect(s.body.messages[0].content[0].text).toBe('<text 6 chars>')
  })
  it('streamChat against the mock: a rejected request throws bad_request with body + summary; the fixed builder succeeds', async () => {
    const mock = await startMockServer()
    try {
      const p = { ...P, baseURL: mock.url.replace(/\/v1$/, '') }
      const ok = await streamChat(p, '', [U('你好')], { model: 'claude-sonnet-5-5', temperature: 0.7, maxTokens: 4096 })
      expect(ok.text).toContain('Claude 模拟回复')
      expect(mock.anthropic.at(-1).body.temperature).toBeUndefined()
      const e = await streamChat(p, '', [U('x')], { model: 'claude-sonnet-5-5', temperature: 0.7, maxTokens: 0.5 as any }).catch(x => x)
      expect(e).toBeInstanceOf(ProviderError); expect(e.code).toBe('bad_request'); expect(e.status).toBe(400)
      expect(JSON.parse(e.body).error.type).toBe('invalid_request_error')
      expect(e.request.headers['x-api-key']).toBe('***'); expect(JSON.stringify(e.request)).not.toContain('sk-ant-secret-123')
    } finally { await mock.close() }
  })
})
