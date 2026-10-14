// Mock OpenAI-compatible server for tests and E2E.
// Behaviour is selected by the model name:
//   mock-ok (default)  normal streaming reply
//   mock-401 / mock-429 / mock-500   HTTP errors with OpenAI-style JSON body
//   mock-timeout       accepts the request but never responds
//   mock-disconnect    streams a few chunks then destroys the socket
//   mock-tool          first asks to call builtin__get_current_time, then answers
//   mock-quota / mock-notfound / mock-context   insufficient balance (402), model not found (404), context too long (400)
//   mock-poem          four-line poem in a blockquote (single newlines)
//   (auto-title)       a request whose last message starts with the title prompt gets TITLE back
//   mock-flaky         503 for the first 2 attempts of each prompt, then succeeds (tests auto-retry)
// Also: usage chunk when stream_options.include_usage, Ollama /api/tags, update feed /updates/latest*.yml,
//       GET /models returns 401 for the key "sk-bad".
// Usage: node tests/mock-server.mjs [port]
import http from 'node:http'

export const REASONING = ['先分析问题，', '再给出答案。']
export const REPLY = ['你好！', '这是来自', '模拟服务器的', '流式回复。', ' Hello from mock.']

/** reply to the auto-title request (quotes are stripped by the client) */
export const TITLE = '「模拟对话标题」'
/** a four-line poem in a blockquote with single newlines (remark-breaks) */
export const POEM = '> 床前明月光\n> 疑是地上霜\n> 举头望明月\n> 低头思故乡'

export const USAGE = { prompt_tokens: 42, completion_tokens: 17 }
export const UPDATE_VERSION = '9.9.9'

export function startMockServer(port = 0) {
  const sockets = new Set()
  const flaky = new Map()
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += d))
    req.on('end', async () => {
      if (req.method === 'GET' && req.url.endsWith('/api/tags')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen2.5:7b' }, { name: 'deepseek-r1:8b' }] }))
      }
      if (req.method === 'GET' && /\/updates\/latest(-linux|-mac)?\.yml(\?|$)/.test(req.url)) {
        res.writeHead(200, { 'Content-Type': 'text/yaml' })
        const file = req.url.includes('linux') ? `tidequill-${UPDATE_VERSION}.AppImage` : `Tidequill-Setup-${UPDATE_VERSION}-x64.exe`
        return res.end(`version: ${UPDATE_VERSION}\nfiles:\n  - url: ${file}\n    sha512: ${'A'.repeat(86)}==\n    size: 1000\npath: ${file}\nsha512: ${'A'.repeat(86)}==\nreleaseDate: '2026-10-01T00:00:00.000Z'\n`)
      }
      if (req.method === 'GET' && req.url.endsWith('/models') && /sk-bad/.test(req.headers.authorization || '')) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-bad', code: 'invalid_api_key' } }))
      }
      if (req.method === 'GET' && req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ data: ['mock-ok', 'mock-401', 'mock-429', 'mock-timeout', 'mock-disconnect', 'mock-tool', 'mock-reason', 'mock-slow', 'mock-quota', 'mock-notfound', 'mock-context', 'mock-flaky', 'gpt-4o-mock', 'claude-mock'].map(id => ({ id })) }))
      }
      if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end('{"error":{"message":"not found"}}') }
      let j = {}
      try { j = JSON.parse(body) } catch {}
      requests.push(j)
      const model = j.model || 'mock-ok'
      const err = (status, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message, type: 'mock' } })) }
      if (model === 'mock-401') return err(401, 'Incorrect API key provided')
      if (model === 'mock-429') return err(429, 'Rate limit reached')
      if (model === 'mock-500') return err(500, 'Internal error')
      if (model === 'mock-quota') { res.writeHead(402, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Insufficient Balance', type: 'insufficient_quota', code: 'insufficient_quota' } })) }
      if (model === 'mock-notfound') { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'The model `mock-notfound` does not exist or you do not have access to it.', code: 'model_not_found' } })) }
      if (model === 'mock-context') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens. However, your messages resulted in 9001 tokens.", code: 'context_length_exceeded' } })) }
      if (model === 'mock-flaky') {
        const key = JSON.stringify((j.messages || []).at(-1)?.content)
        const n = (flaky.get(key) || 0) + 1; flaky.set(key, n)
        if (n <= 2) return err(503, 'Service temporarily unavailable')
      }
      if (model === 'mock-timeout') return // never respond
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const send = o => res.write(`data: ${JSON.stringify(o)}\n\n`)
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const lastRole = (j.messages || []).at(-1)?.role
      if (model === 'mock-tool' && lastRole !== 'tool') {
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'builtin__get_current_time', arguments: '{}' } }] } }] })
        res.write('data: [DONE]\n\n'); return res.end()
      }
      if (model === 'mock-tool') {
        const toolMsg = j.messages.at(-1)
        send({ choices: [{ delta: { content: 'TOOL_RESULT: ' + String(toolMsg.content).slice(0, 60) } }] })
        res.write('data: [DONE]\n\n'); return res.end()
      }
      const lastText = String((j.messages || []).at(-1)?.content || '')
      if (/^(请为下面这段对话起一个标题|Give the conversation below a title)/.test(lastText)) {
        send({ choices: [{ delta: { content: TITLE } }] }); res.write('data: [DONE]\n\n'); return res.end()
      }
      if (model === 'mock-poem') {
        send({ choices: [{ delta: { content: POEM } }] }); res.write('data: [DONE]\n\n'); return res.end()
      }
      if (model === 'mock-reason' || (j.reasoning_effort && j.reasoning_effort !== 'none') || j.thinking?.type === 'enabled') {
        for (const r of REASONING) { send({ choices: [{ delta: { reasoning_content: r } }] }); await sleep(60) }
      }
      if (model === 'mock-slow') {
        for (let i = 0; i < 60 && !res.destroyed; i++) { send({ choices: [{ delta: { content: `chunk${i} ` } }] }); await sleep(100) }
        res.write('data: [DONE]\n\n'); return res.end()
      }
      const parts = model === 'mock-disconnect' ? REPLY.slice(0, 2) : REPLY
      for (const p of parts) { send({ choices: [{ delta: { content: p } }] }); await sleep(120) }
      if (model === 'mock-disconnect') { req.socket.destroy(); return }
      if (j.stream_options?.include_usage) send({ choices: [], usage: { ...USAGE, total_tokens: USAGE.prompt_tokens + USAGE.completion_tokens } })
      res.write('data: [DONE]\n\n'); res.end()
    })
  })
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    port: server.address().port, requests,
    url: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(r => { for (const s of sockets) s.destroy(); server.close(() => r()) }),
  })))
}

if (process.argv[1] && process.argv[1].endsWith('mock-server.mjs')) {
  startMockServer(Number(process.argv[2] || 18080)).then(s => console.log('mock server on', s.url))
}
