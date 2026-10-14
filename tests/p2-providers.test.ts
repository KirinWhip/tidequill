import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { streamChat } from '../src/shared/providers'
// @ts-ignore
import { startMockServer, USAGE } from './mock-server.mjs'

let srv: any
beforeAll(async () => { srv = await startMockServer() })
afterAll(() => srv.close())
const prov = () => ({ id: 'm', name: 'm', type: 'openai' as const, apiKey: 'k', baseURL: srv.url, models: [] })
const run = (model: string, extra: any = {}) => streamChat(prov(), '', [{ id: '1', role: 'user', content: 'hi', createdAt: 1, ...extra }], { model, temperature: 0.5, topP: 0.9, maxTokens: 100, onDelta: () => {} } as any)

describe('provider P2 behaviour against mock server', () => {
  it('parses usage from include_usage chunk', async () => {
    const r = await run('mock-ok')
    expect(r.usage).toMatchObject({ input: USAGE.prompt_tokens, output: USAGE.completion_tokens })
  })
  for (const [model, code] of [['mock-quota', 'quota'], ['mock-notfound', 'not_found'], ['mock-context', 'context_too_long'], ['mock-401', 'auth'], ['mock-429', 'rate_limit'], ['mock-flaky', 'server']] as const)
    it(`${model} -> ${code}`, async () => { await expect(run(model, { content: model + Math.random() })).rejects.toMatchObject({ code }) })
})
