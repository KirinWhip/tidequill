import { describe, it, expect } from 'vitest'
import { Storage, MemoryKV, conversationToMarkdown, importMarkdown, exportJSON, importJSON, searchConversations, sortConversations } from '../src/shared/storage'
import type { Conversation } from '../src/shared/types'

const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id, title: 'T' + id, providerId: 'openai', model: 'gpt', systemPrompt: '', pinned: false, createdAt: 1, updatedAt: 1,
  messages: [{ id: 'm', role: 'user', content: 'hello ' + id, createdAt: 1 }, { id: 'n', role: 'assistant', content: 'answer', createdAt: 1 }], ...extra,
})

describe('Storage', () => {
  it('defaults language to follow system', async () => {
    const s = await new Storage(new MemoryKV()).loadSettings()
    expect(s.language).toBe('system'); expect(s.requestTimeout).toBe(60); expect(s.providers.length).toBeGreaterThan(3)
  })
  it('persists settings', async () => {
    const st = new Storage(new MemoryKV())
    const s = await st.loadSettings(); s.temperature = 1.2; await st.saveSettings(s)
    expect((await st.loadSettings()).temperature).toBe(1.2)
  })
  it('upsert / delete conversations', async () => {
    const st = new Storage(new MemoryKV())
    await st.upsertConversation(conv('a')); await st.upsertConversation(conv('b'))
    await st.upsertConversation(conv('a', { title: 'renamed' }))
    let l = await st.listConversations()
    expect(l).toHaveLength(2); expect(l.find(c => c.id === 'a')!.title).toBe('renamed')
    await st.deleteConversation('a'); l = await st.listConversations()
    expect(l.map(c => c.id)).toEqual(['b'])
  })
  it('sorts pinned first then recent', () => {
    const l = sortConversations([conv('a', { updatedAt: 5 }), conv('b', { updatedAt: 1, pinned: true }), conv('c', { updatedAt: 9 })])
    expect(l.map(c => c.id)).toEqual(['b', 'c', 'a'])
  })
  it('searches titles and messages', () => {
    const l = [conv('a'), conv('b')]
    expect(searchConversations(l, 'hello b').map(c => c.id)).toEqual(['b'])
    expect(searchConversations(l, '')).toHaveLength(2)
  })
  it('markdown roundtrip', () => {
    const c = conv('x', { systemPrompt: 'be nice' })
    const back = importMarkdown(conversationToMarkdown(c))
    expect(back.title).toBe('Tx'); expect(back.systemPrompt).toBe('be nice')
    expect(back.messages.map(m => [m.role, m.content])).toEqual([['user', 'hello x'], ['assistant', 'answer']])
  })
  it('json roundtrip', () => {
    const l = importJSON(exportJSON([conv('a'), conv('b')]))
    expect(l.map(c => c.id)).toEqual(['a', 'b'])
    expect(() => importJSON('{"x":1}')).toThrow()
  })
})
