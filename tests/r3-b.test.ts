import { describe, it, expect } from 'vitest'
import { compareNewest, groupModels, modelFamily } from '../src/shared/modelgroups'
import { contextBreakdown, estimateMessages } from '../src/shared/usage'
import { systemPromptFor } from '../src/shared/chatflags'

describe('B8 model groups', () => {
  it('detects families', () => {
    expect(modelFamily('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet')
    expect(modelFamily('claude-3-5-haiku-latest')).toBe('Claude Haiku')
    expect(modelFamily('openrouter/openai/gpt-4o')).toBe('GPT')
    expect(modelFamily('o3-mini')).toBe('OpenAI o')
    expect(modelFamily('gemini-2.5-pro')).toBe('Gemini')
    expect(modelFamily('mock-ok')).toBe('')
  })
  it('sorts newest first by version numbers, date as tie-breaker', () => {
    const l = ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-sonnet-5-5', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20250101']
    expect([...l].sort(compareNewest)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20250101', 'claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219'])
    expect(['gpt-4o', 'gpt-5.1', 'gpt-4.1', 'gpt-5'].sort(compareNewest)).toEqual(['gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o'])
  })
  it('keeps 3 recent per family, the rest older; current model stays visible; unknown family never collapses', () => {
    const models = ['gpt-3.5-turbo', 'gpt-4', 'gpt-5.1', 'gpt-4.1', 'gpt-5', 'mock-a', 'mock-b', 'mock-c', 'mock-d', 'claude-opus-4-1']
    const g = groupModels(models, 'gpt-3.5-turbo')
    expect(g.map(x => x.family)).toEqual(['GPT', '', 'Claude Opus'])
    expect(g[0].recent).toEqual(['gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-3.5-turbo'])
    expect(g[0].older).toEqual(['gpt-4'])
    expect(g[1].recent).toHaveLength(4)
  })
})

describe('B10 context breakdown', () => {
  const msgs: any[] = [
    { id: '1', role: 'user', content: 'hello world '.repeat(50), createdAt: 0 },
    { id: '2', role: 'assistant', content: 'ok', createdAt: 0, usage: { input: 0, output: 1 } },
  ]
  it('splits system / tools / history / input', () => {
    const b = contextBreakdown(msgs, 'You are helpful.', 20, 'next question', 1000, 300)
    expect(b.parts.tools).toBe(300)
    expect(b.parts.system).toBeGreaterThan(0); expect(b.parts.input).toBeGreaterThan(0)
    expect(b.parts.history).toBe(estimateMessages(msgs, ''))
    expect(b.used).toBe(b.raw); expect(b.calib).toBeUndefined(); expect(b.factor).toBe(1)
  })
  it('calibrates with the last real input usage when off by > 15 %', () => {
    const est = contextBreakdown(msgs.slice(0, 1), 'sys', 20, '', 10000).raw
    const m2 = [msgs[0], { ...msgs[1], usage: { input: est * 2, output: 1 } }]
    const b = contextBreakdown(m2 as any, 'sys', 20, '', 10000)
    expect(b.calib?.real).toBe(est * 2); expect(b.factor).toBeCloseTo(2, 1); expect(b.used).toBeGreaterThan(b.raw * 1.9)
    const m3 = [msgs[0], { ...msgs[1], usage: { input: Math.round(est * 1.1), output: 1 } }]
    expect(contextBreakdown(m3 as any, 'sys', 20, '', 10000).factor).toBe(1)
    const m4 = [msgs[0], { ...msgs[1], usage: { input: est * 2, output: 1, estimated: true } }]
    expect(contextBreakdown(m4 as any, 'sys', 20, '', 10000).calib).toBeUndefined()
  })
})

describe('B12 tell model', () => {
  const t = { tellModelLine: '当前使用的模型是 {model}（服务商：{provider}）。' }
  const s: any = { tellModel: false, providers: [{ id: 'a', name: 'Anthropic' }] }
  it('is off by default and appends a line when on', () => {
    expect(systemPromptFor('base', { model: 'm', providerId: 'a' }, s, t)).toBe('base')
    expect(systemPromptFor('base', { model: 'claude-x', providerId: 'a' }, { ...s, tellModel: true }, t)).toBe('base\n\n当前使用的模型是 claude-x（服务商：Anthropic）。')
    expect(systemPromptFor('', { model: 'm', providerId: 'a' }, { ...s, tellModel: true }, t)).toBe('当前使用的模型是 m（服务商：Anthropic）。')
  })
})
