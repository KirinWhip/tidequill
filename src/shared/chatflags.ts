/** Round 3 · A3/A4: per-conversation toggles (deep thinking, tools, web search).
 *  New conversations take their initial state from Settings > Chat (all off by default); afterwards each
 *  conversation keeps its own state. Conversations created before 1.0.2 (no stored flag) use the defaults. */
import type { Conversation, Settings } from './types'
import type { WebSearchConfig } from './websearch'

export interface ChatDefaults { reasoning: boolean; tools: boolean; webSearch: boolean }
export const DEFAULT_CHAT_DEFAULTS: ChatDefaults = { reasoning: false, tools: false, webSearch: false }

/** web search can only run when the selected provider has its key (or SearXNG its URL) */
export function searchConfigured(ws?: WebSearchConfig): boolean {
  if (!ws) return false
  if (ws.provider === 'searxng') return !!ws.searxngUrl?.trim()
  const k = ({ tavily: ws.tavilyKey, bing: ws.bingKey, brave: ws.braveKey } as Record<string, string>)[ws.provider]
  return !!k
}

export function chatDefaults(s: Pick<Settings, 'chatDefaults'>): ChatDefaults { return { ...DEFAULT_CHAT_DEFAULTS, ...(s.chatDefaults || {}) } }

export function convFlags(c: Pick<Conversation, 'reasoning' | 'tools' | 'webSearch'>, s: Pick<Settings, 'chatDefaults' | 'webSearch'>) {
  const d = chatDefaults(s)
  const webSearch = c.webSearch ?? d.webSearch
  return { reasoning: c.reasoning ?? d.reasoning, tools: c.tools ?? d.tools, webSearch, searchReady: searchConfigured(s.webSearch), webSearchActive: webSearch && searchConfigured(s.webSearch) }
}

/** flags stored on a new conversation */
export function newConvFlags(s: Pick<Settings, 'chatDefaults'>) { const d = chatDefaults(s); return { reasoning: d.reasoning, tools: d.tools, webSearch: d.webSearch } }
