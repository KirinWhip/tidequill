import type { Message } from './types'

export interface Price { pattern: string; input: number; output: number } // USD per 1M tokens; pattern = substring or /regex/

export const DEFAULT_PRICES: Price[] = [
  { pattern: 'gpt-4o-mini', input: 0.15, output: 0.6 },
  { pattern: 'gpt-4o', input: 2.5, output: 10 },
  { pattern: 'gpt-4.1-mini', input: 0.4, output: 1.6 },
  { pattern: 'gpt-4.1', input: 2, output: 8 },
  { pattern: 'o4-mini', input: 1.1, output: 4.4 },
  { pattern: 'claude-opus', input: 15, output: 75 },
  { pattern: 'claude-sonnet', input: 3, output: 15 },
  { pattern: 'claude-3-5-haiku', input: 0.8, output: 4 },
  { pattern: 'gemini-2.5-pro', input: 1.25, output: 10 },
  { pattern: 'gemini-2.5-flash', input: 0.3, output: 2.5 },
  { pattern: 'deepseek-flash', input: 0.3, output: 1.2 },
  { pattern: 'deepseek-v4-pro', input: 1.32, output: 3.96 },
  { pattern: 'deepseek-chat', input: 0.27, output: 1.1 },
  { pattern: 'deepseek-reasoner', input: 0.55, output: 2.19 },
  { pattern: 'grok-4', input: 3, output: 15 },
  { pattern: 'grok-3-mini', input: 0.3, output: 0.5 },
  { pattern: 'qwen-max', input: 1.6, output: 6.4 },
  { pattern: 'qwen-plus', input: 0.4, output: 1.2 },
]

/** rough token estimate: CJK chars ~1 token each, other text ~4 chars/token, images ~ 765 tokens */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g) || []).length
  return Math.ceil(cjk + (text.length - cjk) / 4)
}
export function estimateMessages(msgs: Message[], system = ''): number {
  let n = estimateTokens(system)
  for (const m of msgs) n += 4 + estimateTokens(m.content) + (m.attachments || []).reduce((s, a) => s + estimateTokens(a.text), 0) + (m.images?.length || 0) * 765
  return n
}

export function findPrice(model: string, prices: Price[]): Price | undefined {
  const m = model.toLowerCase()
  for (const p of prices) {
    const re = /^\/(.+)\/([a-z]*)$/.exec(p.pattern)
    if (re ? new RegExp(re[1], re[2] || 'i').test(model) : m.includes(p.pattern.toLowerCase())) return p
  }
}
export function costOf(model: string, u: { input: number; output: number } | undefined, prices: Price[]): number | undefined {
  const p = u && findPrice(model, prices)
  if (!p || !u) return undefined
  return (u.input * p.input + u.output * p.output) / 1e6
}
export function conversationUsage(msgs: Message[], prices: Price[]) {
  let input = 0, output = 0, cost = 0, priced = false, estimated = false, messages = 0
  for (const m of msgs) {
    if (!m.usage) continue
    messages++
    input += m.usage.input; output += m.usage.output; estimated ||= !!m.usage.estimated
    const c = costOf(m.model || '', m.usage, prices)
    if (c != null) { cost += c; priced = true }
  }
  return { input, output, cost: priced ? cost : undefined, estimated, messages }
}
export function formatCost(c: number | undefined): string {
  if (c == null) return ''
  return c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(3)}`
}

/** model context windows (tokens); pattern = substring or /regex/, first match wins. Public figures, editable in Settings > Usage */
export interface ContextWindow { pattern: string; tokens: number }
export const DEFAULT_CONTEXT_WINDOWS: ContextWindow[] = [
  { pattern: 'gpt-4.1', tokens: 1047576 },
  { pattern: 'gpt-4o', tokens: 128000 },
  { pattern: 'gpt-5', tokens: 400000 },
  { pattern: '/^o\\d/', tokens: 200000 },
  { pattern: 'claude', tokens: 200000 },
  { pattern: 'gemini', tokens: 1048576 },
  { pattern: 'deepseek', tokens: 128000 },
  { pattern: 'grok-4', tokens: 256000 },
  { pattern: 'grok-3', tokens: 131072 },
  { pattern: 'qwen-max', tokens: 32768 },
  { pattern: 'qwen', tokens: 131072 },
]
export function findContextWindow(model: string, list: ContextWindow[]): number | undefined {
  return findPrice(model, list.map(w => ({ pattern: w.pattern, input: w.tokens, output: 0 })))?.input || undefined
}

/** tokens the next request will roughly carry: system prompt + the last `contextLength` messages + the draft */
/** Round 3 · B10: what the next request is estimated to carry (system prompt / tool definitions / history / input box),
 *  calibrated with the last provider-reported input tokens when the local estimate deviates by more than 15 % */
export function contextBreakdown(msgs: Message[], system: string, contextLength: number, draft: string, window: number | undefined, toolsTokens = 0) {
  const n = Math.max(1, contextLength)
  const parts = { system: estimateTokens(system), tools: toolsTokens, history: estimateMessages(msgs.slice(-n), ''), input: draft ? 4 + estimateTokens(draft) : 0 }
  const raw = parts.system + parts.tools + parts.history + parts.input
  let calib: { real: number; est: number; factor: number } | undefined
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role !== 'assistant' || !m.usage || m.usage.estimated || !(m.usage.input > 0)) continue
    const before = msgs.slice(0, i).filter(x => !(x.role === 'assistant' && x.error && !x.content)).slice(-n)
    const est = parts.system + parts.tools + estimateMessages(before, '')
    if (est > 0) calib = { real: m.usage.input, est, factor: m.usage.input / est }
    break
  }
  const factor = calib && Math.abs(calib.factor - 1) > 0.15 ? Math.min(3, Math.max(0.5, calib.factor)) : 1
  const used = Math.round(raw * factor)
  const ratio = window ? used / window : 0
  return { used, raw, window, ratio, parts, calib, factor, level: !window ? 'unknown' as const : ratio >= 1 ? 'over' as const : ratio >= 0.8 ? 'near' as const : 'ok' as const }
}

export function contextUsage(msgs: Message[], system: string, contextLength: number, draft: string, window: number | undefined) {
  const ctx = msgs.slice(-Math.max(1, contextLength))
  const used = estimateMessages(ctx, system) + (draft ? 4 + estimateTokens(draft) : 0)
  const ratio = window ? used / window : 0
  return { used, window, ratio, level: !window ? 'unknown' as const : ratio >= 1 ? 'over' as const : ratio >= 0.8 ? 'near' as const : 'ok' as const }
}
