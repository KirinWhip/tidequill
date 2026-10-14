import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// @ts-ignore
import { startMockServer, REPLY } from './mock-server.mjs'
import { runBridgeRequest, validateUrl } from '../electron/http'
import { createBridgeFetch } from '../src/renderer/api'
import { streamChat, listModels } from '../src/shared/providers'
import { ProviderError } from '../src/shared/errors'
import type { ProviderConfig } from '../src/shared/types'

let srv: any
beforeAll(async () => { srv = await startMockServer() })
afterAll(async () => { await srv.close() })

/** full chain: streamChat -> bridge fetch (renderer side) -> runBridgeRequest (main side, Node fetch) -> mock server */
function chain(timeoutMs = 3000) {
  const ctrls = new Map<string, AbortController>()
  return createBridgeFetch(
    (id, req, onEvent) => { const c = new AbortController(); ctrls.set(id, c); runBridgeRequest(fetch, req, onEvent, c.signal) },
    id => ctrls.get(id)?.abort(), id => ctrls.delete(id), () => timeoutMs)
}
const prov = (baseURL: string): ProviderConfig => ({ id: 'm', name: 'mock', type: 'openai', apiKey: 'sk-test', baseURL, models: [] })
const run = (model: string, f = chain(), baseURL = srv.url, signal?: AbortSignal) => {
  const deltas: string[] = []
  return streamChat(prov(baseURL), '', [{ id: '1', role: 'user', content: 'hi', createdAt: 0 }], { model, temperature: 0.5, maxTokens: 10, fetchImpl: f, onDelta: d => deltas.push(d), signal })
    .then(r => ({ ...r, deltas }))
}
const code = async (p: Promise<any>) => { try { await p; return 'no-error' } catch (e: any) { expect(e).toBeInstanceOf(ProviderError); return e.code } }

describe('main-process HTTP bridge against mock server', () => {
  it('streams a normal reply incrementally', async () => {
    const r = await run('mock-ok')
    expect(r.text).toBe(REPLY.join(''))
    expect(r.deltas.length).toBe(REPLY.length)
  })
  it('401 -> auth', async () => { expect(await code(run('mock-401'))).toBe('auth') })
  it('429 -> rate_limit', async () => { expect(await code(run('mock-429'))).toBe('rate_limit') })
  it('500 -> server', async () => { expect(await code(run('mock-500'))).toBe('server') })
  it('no response -> timeout', async () => { expect(await code(run('mock-timeout', chain(800)))).toBe('timeout') })
  it('socket destroyed mid-stream -> disconnected, keeps partial text', async () => {
    try { await run('mock-disconnect'); throw new Error('should fail') } catch (e: any) {
      expect(e.code).toBe('disconnected')
      expect(e.partial.text).toBe(REPLY.slice(0, 2).join(''))
    }
  })
  it('server down -> network', async () => { expect(await code(run('mock-ok', chain(), 'http://127.0.0.1:9/v1'))).toBe('network') })
  it('user abort stops quietly', async () => {
    const c = new AbortController(); setTimeout(() => c.abort(), 200)
    const r = await run('mock-ok', chain(), srv.url, c.signal)
    expect(r.text.length).toBeLessThan(REPLY.join('').length)
  })
  it('non-streaming JSON through bridge (list models)', async () => {
    expect(await listModels(prov(srv.url), chain())).toContain('mock-ok')
  })
  it('rejects non-http urls', () => {
    expect(validateUrl('file:///etc/passwd')).toBe(false)
    expect(validateUrl('https://api.openai.com/v1')).toBe(true)
  })
})
