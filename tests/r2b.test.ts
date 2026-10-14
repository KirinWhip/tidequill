import { describe, it, expect } from 'vitest'
import { contextUsage, DEFAULT_CONTEXT_WINDOWS, findContextWindow } from '../src/shared/usage'
import { defaultSettings } from '../src/shared/storage'
import type { Message } from '../src/shared/types'

const m = (content: string, role: Message['role'] = 'user'): Message => ({ id: content.slice(0, 8), role, content, createdAt: 0 })

describe('B13 context usage', () => {
  it('finds model windows by substring or regex', () => {
    expect(findContextWindow('gpt-4o-mini', DEFAULT_CONTEXT_WINDOWS)).toBe(128000)
    expect(findContextWindow('gpt-4.1', DEFAULT_CONTEXT_WINDOWS)).toBe(1047576)
    expect(findContextWindow('o4-mini', DEFAULT_CONTEXT_WINDOWS)).toBe(200000)
    expect(findContextWindow('claude-sonnet-4-5', DEFAULT_CONTEXT_WINDOWS)).toBe(200000)
    expect(findContextWindow('my-local-model', DEFAULT_CONTEXT_WINDOWS)).toBeUndefined()
  })
  it('estimates system + last N messages + draft and classifies the level', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => m('字'.repeat(100) + i, i % 2 ? 'assistant' : 'user'))
    const all = contextUsage(msgs, '系统', 10, '', 2000)
    const last2 = contextUsage(msgs, '系统', 2, '', 2000)
    expect(last2.used).toBeLessThan(all.used / 3)
    expect(all.level).toBe('ok')
    expect(contextUsage(msgs, '', 10, '字'.repeat(700), 2000).level).toBe('near')
    expect(contextUsage(msgs, '', 10, '字'.repeat(1200), 2000).level).toBe('over')
    expect(contextUsage(msgs, '', 10, '', undefined).level).toBe('unknown')
  })
  it('new settings have defaults', () => {
    const s = defaultSettings()
    expect(s.readingWidth).toBe('standard'); expect(s.contextWindows?.length).toBeGreaterThan(5)
  })
})
