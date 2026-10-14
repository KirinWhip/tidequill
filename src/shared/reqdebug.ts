import { estimateTokens } from './usage'

export interface RequestInfo { url: string; body: any; at: number }
export interface RequestBreakdown {
  totalBytes: number; systemChars: number; toolCount: number; toolsBytes: number; messagesBytes: number
  est: { system: number; tools: number; messages: number; total: number }
}

const bytes = (x: unknown) => x === undefined ? 0 : new TextEncoder().encode(JSON.stringify(x)).length

/** what a chat request actually carries: system prompt, tool definitions and messages (local token estimate) */
export function describeRequest(body: any): RequestBreakdown {
  let system = ''
  let messages: any[] = []
  if (Array.isArray(body?.messages)) {
    messages = body.messages.filter((m: any) => m.role !== 'system')
    system = [typeof body.system === 'string' ? body.system : '', ...body.messages.filter((m: any) => m.role === 'system').map((m: any) => String(m.content || ''))].filter(Boolean).join('\n')
  } else if (Array.isArray(body?.contents)) {
    messages = body.contents
    system = (body.systemInstruction?.parts || []).map((p: any) => p.text || '').join('\n')
  }
  const tools = body?.tools
  const toolCount = Array.isArray(tools) ? tools.reduce((n: number, t: any) => n + (Array.isArray(t.functionDeclarations) ? t.functionDeclarations.length : 1), 0) : 0
  const toolsBytes = bytes(tools)
  const messagesBytes = bytes(messages)
  const est = { system: estimateTokens(system), tools: toolsBytes ? estimateTokens(JSON.stringify(tools)) : 0, messages: estimateTokens(messages.map(m => JSON.stringify(m.content ?? m.parts ?? '')).join(' ')) + messages.length * 4, total: 0 }
  est.total = est.system + est.tools + est.messages
  return { totalBytes: bytes(body), systemChars: system.length, toolCount, toolsBytes, messagesBytes, est }
}
