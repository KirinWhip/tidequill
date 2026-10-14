/** Web search providers. Requests are made with the fetch implementation passed in; in the app that is the
 *  main-process bridge (session 'tidequill-api'), so the renderer itself never talks to the network. */
export type SearchProviderId = 'tavily' | 'searxng' | 'bing' | 'brave'
export const SEARCH_PROVIDERS: SearchProviderId[] = ['tavily', 'searxng', 'bing', 'brave']

export interface WebSearchConfig {
  /** toolbar toggle: search the web before each reply */
  enabled: boolean
  provider: SearchProviderId
  maxResults: number
  tavilyKey: string
  bingKey: string
  braveKey: string
  /** SearXNG instance base URL, e.g. http://localhost:8080 (JSON output must be enabled in its settings.yml) */
  searxngUrl: string
  /** endpoint overrides (empty = official endpoint); also used by the tests to point at a mock server */
  endpoints?: Partial<Record<SearchProviderId, string>>
}

export const DEFAULT_ENDPOINTS: Record<Exclude<SearchProviderId, 'searxng'>, string> = {
  tavily: 'https://api.tavily.com/search',
  // Microsoft retired the Bing Search APIs on 2025-08-11; this only works with a compatible endpoint you set yourself.
  bing: 'https://api.bing.microsoft.com/v7.0/search',
  brave: 'https://api.search.brave.com/res/v1/web/search',
}

/** secret fields: encrypted at rest with safeStorage, removed from backups without keys */
export const SEARCH_KEY_FIELDS = ['tavilyKey', 'bingKey', 'braveKey'] as const

export const DEFAULT_WEB_SEARCH: WebSearchConfig = { enabled: false, provider: 'tavily', maxResults: 5, tavilyKey: '', bingKey: '', braveKey: '', searxngUrl: '', endpoints: {} }

export interface Citation { n: number; title: string; url: string; snippet: string }

export class SearchError extends Error {
  constructor(public code: 'nokey' | 'nourl' | 'http' | 'network' | 'parse', message: string, public status?: number) { super(message) }
}

const endpoint = (c: WebSearchConfig, p: Exclude<SearchProviderId, 'searxng'>) => (c.endpoints?.[p] || DEFAULT_ENDPOINTS[p])
const clip = (s: string, n = 400) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }
const httpOnly = (u: string) => /^https?:\/\//i.test(u)

/** run one search; returns at most maxResults citations numbered from 1 */
export async function webSearch(c: WebSearchConfig, query: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<Citation[]> {
  const n = Math.max(1, Math.min(20, c.maxResults || 5))
  const q = query.trim().slice(0, 400)
  let url = '', init: RequestInit = { signal }
  switch (c.provider) {
    case 'tavily':
      if (!c.tavilyKey) throw new SearchError('nokey', 'Tavily API key missing')
      url = endpoint(c, 'tavily')
      init = { ...init, method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.tavilyKey}` }, body: JSON.stringify({ query: q, max_results: n, search_depth: 'basic' }) }
      break
    case 'searxng': {
      if (!c.searxngUrl) throw new SearchError('nourl', 'SearXNG URL missing')
      const base = c.searxngUrl.replace(/\/+$/, '').replace(/\/search$/, '')
      url = `${base}/search?q=${encodeURIComponent(q)}&format=json`
      init = { ...init, headers: { Accept: 'application/json' } }
      break
    }
    case 'bing':
      if (!c.bingKey) throw new SearchError('nokey', 'Bing key missing')
      url = `${endpoint(c, 'bing')}?q=${encodeURIComponent(q)}&count=${n}&textDecorations=false`
      init = { ...init, headers: { 'Ocp-Apim-Subscription-Key': c.bingKey } }
      break
    case 'brave':
      if (!c.braveKey) throw new SearchError('nokey', 'Brave key missing')
      url = `${endpoint(c, 'brave')}?q=${encodeURIComponent(q)}&count=${n}`
      init = { ...init, headers: { Accept: 'application/json', 'X-Subscription-Token': c.braveKey } }
      break
  }
  let res: Response
  try { res = await fetchImpl(url, init) } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new SearchError('network', String(e?.message || e))
  }
  const text = await res.text()
  if (!res.ok) {
    let msg = text.slice(0, 300)
    try { const j = JSON.parse(text); msg = j.detail?.error || j.error?.message || j.message || j.detail || msg } catch { /* raw */ }
    throw new SearchError('http', `HTTP ${res.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, res.status)
  }
  let j: any
  try { j = JSON.parse(text) } catch { throw new SearchError('parse', 'Response is not JSON' + (c.provider === 'searxng' ? ' (enable "json" in search.formats of settings.yml)' : '')) }
  const raw: { title: string; url: string; snippet: string }[] =
    c.provider === 'tavily' ? (j.results || []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content }))
    : c.provider === 'searxng' ? (j.results || []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content }))
    : c.provider === 'bing' ? (j.webPages?.value || []).map((r: any) => ({ title: r.name, url: r.url, snippet: r.snippet }))
    : (j.web?.results || []).map((r: any) => ({ title: r.title, url: r.url, snippet: String(r.description || '').replace(/<\/?strong>/g, '') }))
  const seen = new Set<string>()
  return raw.filter(r => r.url && httpOnly(r.url) && !seen.has(r.url) && seen.add(r.url)).slice(0, n)
    .map((r, i) => ({ n: i + 1, title: clip(r.title, 160) || r.url, url: r.url, snippet: clip(r.snippet) }))
}

/** the text added to the user's message for this request only (not stored in the conversation) */
export function searchContext(results: Citation[], query: string, lang: 'zh' | 'en'): string {
  const date = new Date().toISOString().slice(0, 10)
  const head = lang === 'zh'
    ? `以下是针对“${query.slice(0, 100)}”的联网搜索结果（${date}）。请结合这些结果回答，引用时在句末用 [编号] 标注来源，例如 [1]；结果不相关时请直接说明。`
    : `Web search results for "${query.slice(0, 100)}" (${date}). Use them in your answer and cite sources with [number] at the end of the sentence, e.g. [1]; say so if they are not relevant.`
  return `\n\n<web_search>\n${head}\n\n${results.map(r => `[${r.n}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')}\n</web_search>`
}

/** turn [n] / [n][m] / [n, m] markers into markdown links to the cited source (code spans and fences are left alone) */
export function linkCitations(md: string, cites: Citation[]): string {
  if (!cites?.length) return md
  const byN = new Map(cites.map(c => [c.n, c]))
  const parts = md.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
  return parts.map((p, i) => i % 2 ? p : p.replace(/\[(\d{1,2}(?:\s*[,，]\s*\d{1,2})*)\](?!\()/g, (all, nums: string) => {
    const ns = nums.split(/[,，]/).map(x => +x.trim())
    if (!ns.every(x => byN.has(x))) return all
    return ns.map(x => `[\\[${x}\\]](<${byN.get(x)!.url.replace(/[<>\s]/g, encodeURIComponent)}> "cite-${x}")`).join('')
  })).join('')
}
