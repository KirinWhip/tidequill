// Mock OpenAI-compatible server for tests and E2E.
// Behaviour is selected by the model name:
//   mock-ok (default)  normal streaming reply
//   mock-401 / mock-429 / mock-500   HTTP errors with OpenAI-style JSON body
//   mock-timeout       accepts the request but never responds
//   mock-disconnect    streams a few chunks then destroys the socket
//   mock-tool          first asks to call builtin__get_current_time, then answers
//   mock-tool-plugin   same, but calls the hello__greet tool of the E2E plugin (runs in the plugin host process)
//   mock-quota / mock-notfound / mock-context   insufficient balance (402), model not found (404), context too long (400)
//   mock-poem          four-line poem in a blockquote (single newlines)
//   (auto-title)       a request whose last message starts with the title prompt gets TITLE back
//   mock-flaky         503 for the first 2 attempts of each prompt, then succeeds (tests auto-retry)
// Also: usage chunk when stream_options.include_usage, Ollama /api/tags, update feed /updates/latest*.yml,
//       GET /models returns 401 for the key "sk-bad".
// Usage: node tests/mock-server.mjs [port]
import http from 'node:http'
import { handleAnthropic } from './mock-anthropic.mjs'

export const REASONING = ['先分析问题，', '再给出答案。']
export const REPLY = ['你好！', '这是来自', '模拟服务器的', '流式回复。', ' Hello from mock.']

/** reply to the auto-title request (quotes are stripped by the client) */
export const TITLE = '「模拟对话标题」'
/** a four-line poem in a blockquote with single newlines (remark-breaks) */
export const POEM = '> 床前明月光\n> 疑是地上霜\n> 举头望明月\n> 低头思故乡'

export const USAGE = { prompt_tokens: 42, completion_tokens: 17 }
export const UPDATE_VERSION = '9.9.9'

/** Round 2 · C: mocked web search APIs (same response shapes as the real services) */
export const SEARCH_RESULTS = [
  { title: '潮汐 - 维基百科', url: 'https://zh.wikipedia.org/wiki/%E6%BD%AE%E6%B1%90', content: '潮汐是海水在月球和太阳引力作用下发生的周期性涨落现象。' },
  { title: 'Tides | NOAA Ocean Service', url: 'https://oceanservice.noaa.gov/education/tutorial_tides/', content: 'Most coastal areas experience two high tides and two low tides every lunar day.' },
  { title: 'Why are there two tides a day?', url: 'https://example.org/tides-two-a-day', content: 'The Moon creates two tidal bulges, one on each side of the Earth.' },
]
/** reply of any chat model when the request carries search results */
export const CITED_REPLY = '潮汐主要由月球引力引起 [1]，大多数海岸每天出现两次高潮和两次低潮 [2]。地球两侧各有一个潮汐隆起 [3]。'
export const TRANSCRIPT = '这是一段语音转写的测试文本'
export const COMPARE_REPLIES = { 'cmp-a': '模型 A 的回答：潮汐每天两次。', 'cmp-b': '模型 B 的回答：主要原因是月球引力。', 'cmp-c': 'Model C: two bulges, two tides.' }

export function startMockServer(port = 0, opts = {}) {
  const sockets = new Set()
  const flaky = new Map()
  const requests = []
  const searches = [] // { provider, method, url, headers, body }
  const transcriptions = [] // { contentType, model, language, fileName, fileBytes, auth }
  const timings = [] // receive time of each request (diagnostics)
  const anthropic = [] // Round 3: requests to the strict Anthropic mock
  const auths = [] // Authorization header of each /chat/completions request (Round 3 · A6)
  const server = http.createServer((req, res) => {
    timings.push({ ev: 'req', at: Date.now(), url: req.url, rport: req.socket.remotePort })
    let body = ''
    const raw = []
    req.on('data', d => { raw.push(d); body += d })
    req.on('end', async () => {
      const u = new URL(req.url, 'http://x')
      const json = (status, o) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
      // ---- web search ----
      if (u.pathname === '/search/tavily') {
        let j = {}; try { j = JSON.parse(body) } catch {}
        searches.push({ provider: 'tavily', method: req.method, query: j.query, auth: req.headers.authorization, max: j.max_results })
        if (!/^Bearer tvly-/.test(req.headers.authorization || '')) return json(401, { detail: { error: 'Unauthorized: missing or invalid API key.' } })
        return json(200, { query: j.query, results: SEARCH_RESULTS.slice(0, j.max_results || 5).map(r => ({ ...r, score: 0.9 })) })
      }
      if (u.pathname === '/searxng/search') {
        searches.push({ provider: 'searxng', method: req.method, query: u.searchParams.get('q'), format: u.searchParams.get('format') })
        if (u.searchParams.get('format') !== 'json') { res.writeHead(403); return res.end('Forbidden') }
        return json(200, { query: u.searchParams.get('q'), results: SEARCH_RESULTS.map(r => ({ ...r, engine: 'mock' })) })
      }
      if (u.pathname === '/bing/v7.0/search') {
        searches.push({ provider: 'bing', method: req.method, query: u.searchParams.get('q'), key: req.headers['ocp-apim-subscription-key'], count: u.searchParams.get('count') })
        if (!req.headers['ocp-apim-subscription-key']) return json(401, { error: { code: '401', message: 'Access denied due to missing subscription key.' } })
        return json(200, { webPages: { value: SEARCH_RESULTS.map(r => ({ name: r.title, url: r.url, snippet: r.content })) } })
      }
      if (u.pathname === '/brave/res/v1/web/search') {
        searches.push({ provider: 'brave', method: req.method, query: u.searchParams.get('q'), key: req.headers['x-subscription-token'], count: u.searchParams.get('count') })
        if (!req.headers['x-subscription-token']) return json(422, { message: 'missing token' })
        return json(200, { web: { results: SEARCH_RESULTS.map(r => ({ title: r.title, url: r.url, description: `<strong>${r.content}</strong>` })) } })
      }
      // ---- speech to text (OpenAI-compatible multipart) ----
      if (u.pathname.endsWith('/audio/transcriptions')) {
        const buf = Buffer.concat(raw)
        const ct = req.headers['content-type'] || ''
        // linear-time multipart parsing (no backtracking regexes); field names go into a Map, never object keys
        const bi = ct.indexOf('boundary=')
        const boundary = bi >= 0 ? ct.slice(bi + 9).split(';')[0].trim() : ''
        const fields = new Map(); let fileName = '', fileBytes = 0, fileType = ''
        const attr = (head, name) => { const k = head.indexOf(name + '="'); if (k < 0) return ''; const st = k + name.length + 2; const en = head.indexOf('"', st); return en < 0 ? '' : head.slice(st, en) }
        if (boundary) for (const part of buf.toString('latin1').split('--' + boundary)) {
          const sep = part.indexOf('\r\n\r\n'); if (sep < 0) continue
          const head = part.slice(0, sep); let body = part.slice(sep + 4)
          if (body.endsWith('\r\n')) body = body.slice(0, -2)
          const name = attr(head, ' name') || attr(head, ';name'); if (!name) continue
          const fn = attr(head, 'filename')
          if (fn) { fileName = fn; fileBytes = body.length; const ci = head.indexOf('Content-Type: '); fileType = ci >= 0 ? head.slice(ci + 14).split('\r\n')[0] : '' } else fields.set(name, body)
        }
        transcriptions.push({ contentType: ct.split(';')[0], model: fields.get('model'), language: fields.get('language'), fileName, fileType, fileBytes, auth: req.headers.authorization })
        if (!fileBytes) return json(400, { error: { message: 'file is empty' } })
        return json(200, { text: TRANSCRIPT })
      }
      // ---- OCR language data (served from a local file given in opts.ocrDir) ----
      if (u.pathname.startsWith('/ocr/') && opts.ocrDir) {
        const fs = await import('node:fs'); const path = await import('node:path')
        const f = path.join(opts.ocrDir, path.basename(u.pathname))
        if (!fs.existsSync(f)) { res.writeHead(404); return res.end('no such language') }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(fs.readFileSync(f))
      }
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
      if (req.method === 'POST' && u.pathname.endsWith('/v1/messages')) return handleAnthropic(req, res, body, anthropic)
      if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end('{"error":{"message":"not found"}}') }
      let j = {}
      try { j = JSON.parse(body) } catch {}
      requests.push(j); auths.push(req.headers.authorization || '')
      timings.push({ at: Date.now(), model: j.model, last: String((j.messages || []).at(-1)?.content || '').slice(0, 40) })
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
      if ((model === 'mock-tool' || model === 'mock-tool-plugin') && lastRole !== 'tool') {
        const call = model === 'mock-tool' ? { name: 'builtin__get_current_time', arguments: '{}' } : { name: 'hello__greet', arguments: '{"who":"e2e"}' }
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: call }] } }] })
        res.write('data: [DONE]\n\n'); return res.end()
      }
      if (model === 'mock-tool' || model === 'mock-tool-plugin') {
        const toolMsg = j.messages.at(-1)
        send({ choices: [{ delta: { content: 'TOOL_RESULT: ' + String(toolMsg.content).slice(0, 60) } }] })
        res.write('data: [DONE]\n\n'); return res.end()
      }
      const lastText = String((j.messages || []).at(-1)?.content || '')
      if (COMPARE_REPLIES[model]) {
        for (const p of COMPARE_REPLIES[model].match(/.{1,6}/g)) { send({ choices: [{ delta: { content: p } }] }); await sleep(model === 'cmp-b' ? 90 : 50) }
        res.write('data: [DONE]\n\n'); return res.end()
      }
      if (lastText.includes('<web_search>')) {
        send({ choices: [{ delta: { content: CITED_REPLY } }] }); res.write('data: [DONE]\n\n'); return res.end()
      }
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
  server.on('connection', s => { timings.push({ ev: 'conn', at: Date.now(), rport: s.remotePort }); sockets.add(s); s.on('close', () => sockets.delete(s)) })
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    port: server.address().port, requests, auths, timings, anthropic, searches, transcriptions,
    url: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(r => { for (const s of sockets) s.destroy(); server.close(() => r()) }),
  })))
}

if (process.argv[1] && process.argv[1].endsWith('mock-server.mjs')) {
  startMockServer(Number(process.argv[2] || 18080)).then(s => console.log('mock server on', s.url))
}
