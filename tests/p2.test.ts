import { describe, it, expect, vi } from 'vitest'
import { classifyError, withRetry, ProviderError } from '../src/shared/errors'
import { estimateTokens, findPrice, costOf, conversationUsage, formatCost, DEFAULT_PRICES } from '../src/shared/usage'
import { branchAt, switchBranch, branchInfo, forkConversation } from '../src/shared/branches'
import { makeBackup, parseBackup, restoreSettings, mergeConversations, mergeSync, makeSyncPayload } from '../src/shared/sync'
import { encryptSettings, decryptSettings, ENC_PREFIX, type Cipher } from '../electron/secrets'
import { searchConversations, searchSnippet } from '../src/shared/storage'
import type { Conversation, Message } from '../src/shared/types'

const msg = (id: string, role: Message['role'], content: string, extra: Partial<Message> = {}): Message => ({ id, role, content, createdAt: 1, ...extra })
const conv = (id: string, messages: Message[], extra: Partial<Conversation> = {}): Conversation => ({ id, title: id, messages, providerId: 'p', model: 'm', systemPrompt: '', pinned: false, createdAt: 1, updatedAt: 1, ...extra })

describe('classifyError', () => {
  const cases: [number, string, string][] = [
    [401, '{"error":{"message":"Incorrect API key provided","code":"invalid_api_key"}}', 'auth'],
    [429, '{"error":{"message":"You exceeded your current quota","type":"insufficient_quota"}}', 'quota'],
    [402, '{"error":{"message":"Insufficient Balance"}}', 'quota'],
    [400, '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}', 'quota'],
    [429, '{"error":{"message":"Rate limit reached for requests"}}', 'rate_limit'],
    [404, '{"error":{"message":"The model `gpt-9` does not exist","code":"model_not_found"}}', 'not_found'],
    [400, '{"error":{"message":"This model\'s maximum context length is 8192 tokens","code":"context_length_exceeded"}}', 'context_too_long'],
    [400, '{"type":"error","error":{"message":"prompt is too long: 210000 tokens > 200000 maximum"}}', 'context_too_long'],
    [400, '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}', 'auth'],
    [529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', 'server'],
    [503, 'Service Unavailable', 'server'],
    [504, '', 'timeout'],
    [400, '{"error":{"message":"bad"}}', 'bad_request'],
  ]
  for (const [s, b, code] of cases) it(`${s} ${code}`, () => expect(classifyError(s, b)).toBe(code))
})

describe('withRetry', () => {
  it('retries retryable errors with backoff then succeeds', async () => {
    let n = 0; const onRetry = vi.fn()
    const r = await withRetry(async () => { if (n++ < 2) throw new ProviderError('server', 'x', 503); return 'ok' }, { retries: 3, baseMs: 5, onRetry })
    expect(r).toBe('ok'); expect(n).toBe(3); expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry.mock.calls[0][0]).toBe(1); expect(onRetry.mock.calls[1][1]).toBeGreaterThan(onRetry.mock.calls[0][1])
  })
  it('does not retry non-retryable errors', async () => {
    let n = 0
    await expect(withRetry(async () => { n++; throw new ProviderError('auth') }, { retries: 3, baseMs: 1 })).rejects.toThrow()
    expect(n).toBe(1)
  })
  it('gives up after N retries', async () => {
    let n = 0
    await expect(withRetry(async () => { n++; throw new ProviderError('rate_limit') }, { retries: 2, baseMs: 1 })).rejects.toMatchObject({ code: 'rate_limit' })
    expect(n).toBe(3)
  })
  it('stops when canRetry is false (output already streamed)', async () => {
    let n = 0
    await expect(withRetry(async () => { n++; throw new ProviderError('server') }, { retries: 3, baseMs: 1 }, () => false)).rejects.toThrow()
    expect(n).toBe(1)
  })
  it('abort during backoff rejects', async () => {
    const c = new AbortController()
    const p = withRetry(async () => { throw new ProviderError('server') }, { retries: 3, baseMs: 10000, signal: c.signal })
    setTimeout(() => c.abort(), 10)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('usage & cost', () => {
  it('estimates tokens for CJK and latin', () => {
    expect(estimateTokens('')).toBe(0); expect(estimateTokens('你好世界')).toBe(4); expect(estimateTokens('abcdefgh')).toBe(2)
  })
  it('matches prices by substring order and regex', () => {
    expect(findPrice('gpt-4o-mini-2024', DEFAULT_PRICES)?.input).toBe(0.15)
    expect(findPrice('gpt-4o', DEFAULT_PRICES)?.input).toBe(2.5)
    expect(findPrice('my-model-x', [{ pattern: '/^my-.*-x$/', input: 1, output: 2 }])?.output).toBe(2)
    expect(findPrice('unknown', DEFAULT_PRICES)).toBeUndefined()
  })
  it('computes cost and conversation totals', () => {
    const prices = [{ pattern: 'mock', input: 1, output: 2 }]
    expect(costOf('mock-ok', { input: 1_000_000, output: 500_000 }, prices)).toBe(2)
    const t = conversationUsage([msg('a', 'assistant', '', { model: 'mock-ok', usage: { input: 100, output: 50 } }), msg('b', 'assistant', '', { model: 'x', usage: { input: 10, output: 5, estimated: true } }), msg('c', 'user', 'hi')], prices)
    expect(t).toMatchObject({ input: 110, output: 55, estimated: true, messages: 2 })
    expect(t.cost).toBeCloseTo(0.0002)
    expect(formatCost(0.0002)).toBe('$0.0002'); expect(formatCost(1.5)).toBe('$1.500'); expect(formatCost(undefined)).toBe('')
  })
})

describe('branches', () => {
  const base = conv('c', [msg('u1', 'user', 'q1'), msg('a1', 'assistant', 'A1'), msg('u2', 'user', 'q2'), msg('a2', 'assistant', 'A2')])
  it('regenerate keeps old reply as branch and allows switching back', () => {
    let c = branchAt(base, 3, [msg('a2b', 'assistant', 'A2b')])
    expect(c.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2b'])
    expect(branchInfo(c, 3)).toEqual({ index: 1, total: 2 })
    c = switchBranch(c, 3, 0)
    expect(c.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    c = switchBranch(c, 3, 1); expect(c.messages[3].id).toBe('a2b')
  })
  it('edit at an earlier position preserves nested branches inside the old variant', () => {
    let c = branchAt(base, 3, [msg('a2b', 'assistant', 'A2b')])
    c = branchAt(c, 0, [msg('u1e', 'user', 'edited')])
    expect(c.messages.map(m => m.id)).toEqual(['u1e'])
    expect(branchInfo(c, 3)).toBeNull()
    c = switchBranch(c, 0, 0)
    expect(c.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2b'])
    expect(branchInfo(c, 3)).toEqual({ index: 1, total: 2 })
  })
  it('fork creates a new conversation up to the message', () => {
    const f = forkConversation(base, 'a1', 'n', 'fork')
    expect(f.messages.map(m => m.id)).toEqual(['u1', 'a1']); expect(f.forkOf).toEqual({ id: 'c', messageId: 'a1' }); expect(f.id).toBe('n')
    expect(base.messages).toHaveLength(4)
  })
})

describe('backup & sync', () => {
  const settings = { providers: [{ id: 'openai', apiKey: 'sk-1' }], webdav: { url: 'u', password: 'pw', username: 'x', enabled: true } }
  it('backup scrubs secrets by default, includes them on request', () => {
    const b = makeBackup({ settings, conversations: [] })
    expect(JSON.stringify(b)).not.toContain('sk-1'); expect(JSON.stringify(b)).not.toContain('"pw"')
    expect(JSON.stringify(makeBackup({ settings }, true))).toContain('sk-1')
    expect(parseBackup(JSON.stringify(b)).data.conversations).toEqual([])
    expect(() => parseBackup('{"a":1}')).toThrow()
  })
  it('restore keeps current secrets when backup has none', () => {
    const r = restoreSettings(settings, { providers: [{ id: 'openai', apiKey: '' }], webdav: { url: 'u2', password: '' } })
    expect(r.providers[0].apiKey).toBe('sk-1'); expect(r.webdav.password).toBe('pw'); expect(r.webdav.url).toBe('u2')
  })
  it('merges conversations: newer wins, tombstones delete', () => {
    const l = [conv('a', [], { updatedAt: 5, title: 'local' }), conv('b', [], { updatedAt: 1 })]
    const r = [conv('a', [], { updatedAt: 3, title: 'remote' }), conv('c', [], { updatedAt: 2 })]
    const m = mergeConversations(l, r, { b: 2 })
    expect(m.map(c => c.id).sort()).toEqual(['a', 'c']); expect(m.find(c => c.id === 'a')!.title).toBe('local')
  })
  it('mergeSync unions tombstones and lists', () => {
    const remote = makeSyncPayload({ conversations: [conv('x', [], { updatedAt: 1 })], tombstones: { y: 9 }, folders: [{ id: 'f1' }], personas: [], prompts: [] })
    const m = mergeSync({ conversations: [conv('y', [], { updatedAt: 2 })], tombstones: { z: 1 }, folders: [{ id: 'f2' }], personas: [], prompts: [] }, remote)
    expect(m.conversations.map(c => c.id)).toEqual(['x']); expect(m.tombstones).toEqual({ y: 9, z: 1 }); expect(m.folders).toHaveLength(2)
  })
})

describe('webdav password encryption', () => {
  const rot: Cipher = { available: () => true, encrypt: s => Buffer.from(s).reverse().toString('base64'), decrypt: s => Buffer.from(s, 'base64').reverse().toString() }
  it('encrypts and decrypts the webdav password', () => {
    const e = encryptSettings({ providers: [], webdav: { password: 'dav-secret' } }, rot)
    expect(e.webdav.password.startsWith(ENC_PREFIX)).toBe(true); expect(JSON.stringify(e)).not.toContain('dav-secret')
    expect(decryptSettings(e, rot).settings.webdav.password).toBe('dav-secret')
    expect(decryptSettings({ providers: [], webdav: { password: 'plain' } }, rot).needsMigration).toBe(true)
  })
})

describe('search', () => {
  const list = [conv('a', [msg('1', 'user', 'how to bake sourdough bread at home')], { title: 'Cooking', tags: ['food'] }), conv('b', [], { title: 'Other', tags: ['work'] })]
  it('finds by message content and tag, with snippet', () => {
    expect(searchConversations(list, 'sourdough').map(c => c.id)).toEqual(['a'])
    expect(searchConversations(list, 'work').map(c => c.id)).toEqual(['b'])
    expect(searchSnippet(list[0], 'sourdough')).toContain('sourdough')
  })
})
