// Mock OpenAI-compatible server for tests and E2E.
// Behaviour is selected by the model name:
//   mock-ok (default)  normal streaming reply
//   mock-401 / mock-429 / mock-500   HTTP errors with OpenAI-style JSON body
//   mock-timeout       accepts the request but never responds
//   mock-disconnect    streams a few chunks then destroys the socket
//   mock-tool          first asks to call builtin__get_current_time, then answers
// Usage: node tests/mock-server.mjs [port]
import http from 'node:http'

export const REASONING = ['先分析问题，', '再给出答案。']
export const REPLY = ['你好！', '这是来自', '模拟服务器的', '流式回复。', ' Hello from mock.']

export function startMockServer(port = 0) {
  const sockets = new Set()
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', d => (body += d))
    req.on('end', async () => {
      if (req.method === 'GET' && req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ data: ['mock-ok', 'mock-401', 'mock-429', 'mock-timeout', 'mock-disconnect', 'mock-tool', 'mock-reason', 'mock-slow', 'gpt-4o-mock', 'claude-mock'].map(id => ({ id })) }))
      }
      if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end('{"error":{"message":"not found"}}') }
      let j = {}
      try { j = JSON.parse(body) } catch {}
      const model = j.model || 'mock-ok'
      const err = (status, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message, type: 'mock' } })) }
      if (model === 'mock-401') return err(401, 'Incorrect API key provided')
      if (model === 'mock-429') return err(429, 'Rate limit reached')
      if (model === 'mock-500') return err(500, 'Internal error')
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
      if (model === 'mock-reason' || j.reasoning_effort) {
        for (const r of REASONING) { send({ choices: [{ delta: { reasoning_content: r } }] }); await sleep(60) }
      }
      if (model === 'mock-slow') {
        for (let i = 0; i < 60 && !res.destroyed; i++) { send({ choices: [{ delta: { content: `chunk${i} ` } }] }); await sleep(100) }
        res.write('data: [DONE]\n\n'); return res.end()
      }
      const parts = model === 'mock-disconnect' ? REPLY.slice(0, 2) : REPLY
      for (const p of parts) { send({ choices: [{ delta: { content: p } }] }); await sleep(120) }
      if (model === 'mock-disconnect') { req.socket.destroy(); return }
      res.write('data: [DONE]\n\n'); res.end()
    })
  })
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    port: server.address().port,
    url: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(r => { for (const s of sockets) s.destroy(); server.close(() => r()) }),
  })))
}

if (process.argv[1] && process.argv[1].endsWith('mock-server.mjs')) {
  startMockServer(Number(process.argv[2] || 18080)).then(s => console.log('mock server on', s.url))
}
