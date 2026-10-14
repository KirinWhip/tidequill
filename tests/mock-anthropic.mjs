// Strict mock of the Anthropic Messages API (Round 3 · A5).
// Validates requests against the documented rules and answers like the real API:
//   https://platform.claude.com/docs/en/build-with-claude/thinking            (per-model thinking table)
//   https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting
//   https://platform.claude.com/docs/en/build-with-claude/extended-thinking   (budget_tokens >= 1024 and < max_tokens)
// A 400 body has the real shape { type: 'error', error: { type: 'invalid_request_error', message } }.

/** model family helpers (same model ids as the real API, e.g. claude-sonnet-5-5, claude-opus-4-7, claude-sonnet-4-5) */
const ver = m => { const x = /claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/.exec(m); return x ? +x[1] + (x[2] && x[2].length <= 2 ? +x[2] / 10 : 0) : 0 }
const fam = m => (/claude-(opus|sonnet|haiku|fable|mythos)/.exec(m) || [])[1] || ''
/** non-default temperature / top_p / top_k -> 400 on every request (Claude 4.7+ and 5.x) */
export const samplingLocked = m => ver(m) >= 4.7
export const adaptiveSupported = m => ver(m) >= 4.6
export const enabledSupported = m => ver(m) < 4.7
/** thinking on when no `thinking` field is sent (5.x) */
export const thinkingDefaultOn = m => ver(m) >= 5
export function disabledSupported(m) { const v = ver(m), f = fam(m); if (v >= 5) return (f === 'haiku' && v === 5.5) || (f === 'opus' && v === 5) || (f === 'sonnet' && v === 5); return v > 0 }
export const betweenToolsSupported = m => fam(m) === 'sonnet' && ver(m) === 5.5
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

/** returns an error message (as the real API words it, abbreviated) or '' when the request is valid */
export function validateAnthropic(j) {
  const m = String(j.model || '')
  if (!m) return 'model: Field required'
  if (!Number.isInteger(j.max_tokens) || j.max_tokens < 1) return 'max_tokens: Field required'
  if (!Array.isArray(j.messages) || !j.messages.length) return 'messages: at least one message is required'
  const th = j.thinking
  const type = th?.type
  if (type === 'enabled' && !enabledSupported(m)) return '"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.'
  if (type === 'adaptive' && !adaptiveSupported(m)) return 'adaptive thinking is not supported on this model'
  if (type === 'disabled' && !disabledSupported(m)) return `"thinking.type.disabled" is not supported for this model.${betweenToolsSupported(m) ? ' Use "thinking.type.between_tools" to turn off up-front thinking.' : ''}`
  if (type === 'between_tools' && !betweenToolsSupported(m)) return '"thinking.type.between_tools" is not supported for this model.'
  if (th && 'display' in th && (type === 'disabled' || type === 'between_tools')) return `thinking.display: not allowed with thinking.type "${type}"`
  if (th && 'display' in th && !['summarized', 'omitted', 'updates'].includes(th.display)) return 'thinking.display: invalid value'
  if (type === 'enabled') {
    if (!Number.isInteger(th.budget_tokens) || th.budget_tokens < 1024) return 'thinking.enabled.budget_tokens: Input should be greater than or equal to 1024'
    if (th.budget_tokens >= j.max_tokens) return '`max_tokens` must be greater than `thinking.budget_tokens`. Please consult our documentation at https://docs.claude.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size'
  }
  const thinkingOn = type === 'enabled' || type === 'adaptive' || (!th && thinkingDefaultOn(m))
  if (samplingLocked(m)) {
    for (const k of ['temperature', 'top_p', 'top_k']) if (j[k] !== undefined) return `\`${k}\` is deprecated for this model.`
  } else {
    if (j.temperature !== undefined && j.top_p !== undefined && ver(m) >= 4.5) return '`temperature` and `top_p` cannot both be specified for this model. Please use only one.'
    if (thinkingOn && j.temperature !== undefined && j.temperature !== 1) return '`temperature` may only be set to 1 when thinking is enabled. Please consult our documentation at https://docs.claude.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking'
    if (thinkingOn && j.top_k !== undefined) return '`top_k` cannot be set when thinking is enabled.'
    if (thinkingOn && j.top_p !== undefined && (j.top_p < 0.95 || j.top_p > 1)) return '`top_p` must be between 0.95 and 1 when thinking is enabled.'
  }
  for (const [i, t] of (j.tools || []).entries()) {
    if (!TOOL_NAME.test(String(t.name || ''))) return `tools.${i}.custom.name: String should match pattern '^[a-zA-Z0-9_-]{1,64}$'`
    if (!t.input_schema || t.input_schema.type !== 'object') return `tools.${i}.custom.input_schema.type: Input should be 'object'`
  }
  if (j.messages[0].role !== 'user') return 'messages: first message must use the "user" role'
  for (const [i, msg] of j.messages.entries()) {
    if (i && msg.role === j.messages[i - 1].role) return `messages: roles must alternate between "user" and "assistant", but found multiple "${msg.role}" roles in a row`
    const blocks = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content
    if (!Array.isArray(blocks) || !blocks.length) return `messages.${i}: all messages must have non-empty content except for the optional final assistant message`
    for (const [k, b] of blocks.entries()) if (b.type === 'text' && !String(b.text || '').trim()) return `messages.${i}.content.${k}.text: text content blocks must contain non-whitespace text`
    // with thinking on, an assistant turn that calls tools must start with the thinking block returned by the API (signature)
    if (msg.role === 'assistant' && thinkingOn && blocks.some(b => b.type === 'tool_use') && i === j.messages.length - 2 && blocks[0].type !== 'thinking' && blocks[0].type !== 'redacted_thinking')
      return 'messages.' + i + '.content.0.type: Expected `thinking` or `redacted_thinking`, but found `tool_use`. When `thinking` is enabled, a final `assistant` message must start with a thinking block (preceeding the lastmost set of `tool_use` and `tool_result` blocks).'
    for (const b of blocks) if (b.type === 'thinking' && b.signature !== 'sig-mock-1') return 'Invalid `signature` in `thinking` block'
  }
  return ''
}

/** handle POST /v1/messages; returns true when handled */
export async function handleAnthropic(req, res, body, log) {
  let j = {}
  try { j = JSON.parse(body) } catch {}
  log.push({ body: j, headers: { 'x-api-key': req.headers['x-api-key'], 'anthropic-version': req.headers['anthropic-version'] } })
  // test trigger: a request with thinking whose last user text contains [mock-400-thinking] is rejected (error-card UI tests)
  const lastText = JSON.stringify(j.messages?.at(-1)?.content || '')
  const err = validateAnthropic(j) || (j.thinking && ['adaptive', 'enabled'].includes(j.thinking.type) && lastText.includes('[mock-400-thinking]') ? 'thinking: rejected by the mock for this message (test trigger)' : '')
  if (err) { res.writeHead(400, { 'Content-Type': 'application/json', 'request-id': 'req_mock_400' }); res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: err }, request_id: 'req_mock_400' })); return true }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  const ev = (type, o) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`)
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const m = String(j.model)
  const type = j.thinking?.type
  const thinkingOn = type === 'enabled' || type === 'adaptive' || (!j.thinking && thinkingDefaultOn(m))
  const showThinking = thinkingOn && (j.thinking?.display === 'summarized' || (type === 'enabled' && !j.thinking?.display) || (type === 'adaptive' && !samplingLocked(m) && !j.thinking?.display))
  ev('message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', model: m, content: [], usage: { input_tokens: 57, output_tokens: 1 } } })
  let idx = 0
  if (thinkingOn) {
    ev('content_block_start', { index: idx, content_block: { type: 'thinking', thinking: '', signature: '' } })
    if (showThinking) ev('content_block_delta', { index: idx, delta: { type: 'thinking_delta', thinking: '先想一想，' } })
    ev('content_block_delta', { index: idx, delta: { type: 'signature_delta', signature: 'sig-mock-1' } })
    ev('content_block_stop', { index: idx }); idx++
  }
  const last = j.messages.at(-1)
  const lastBlocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content
  const wantsTool = (j.tools || []).length && lastBlocks.some(b => b.type === 'text' && /调用工具|use the tool/.test(b.text)) && !lastBlocks.some(b => b.type === 'tool_result')
  if (wantsTool) {
    ev('content_block_start', { index: idx, content_block: { type: 'tool_use', id: 'toolu_mock_1', name: j.tools[0].name, input: {} } })
    ev('content_block_delta', { index: idx, delta: { type: 'input_json_delta', partial_json: '{}' } })
    ev('content_block_stop', { index: idx })
    ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } })
  } else {
    ev('content_block_start', { index: idx, content_block: { type: 'text', text: '' } })
    for (const p of ['Claude 模拟回复：', '一切正常。']) { ev('content_block_delta', { index: idx, delta: { type: 'text_delta', text: p } }); await sleep(40) }
    ev('content_block_stop', { index: idx })
    ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 21 } })
  }
  ev('message_stop', {})
  res.end()
  return true
}
