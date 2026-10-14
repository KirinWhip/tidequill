/** Round 3 · A6: API keys / passwords never reach the renderer.
 *  The renderer only ever sees an opaque placeholder ("sentinel") per saved secret, e.g. tqsk_3f9a… for
 *  providers/<id>/apiKey. Requests still go through the main-process HTTP bridge; there the sentinel is replaced with
 *  the real value, but only for requests to the host the secret is bound to (the host of the provider / search /
 *  WebDAV URL at the time the secret was saved). Pure functions here; electron/main.ts wires them to IPC.
 *  No electron imports, unit-tested in tests/vault.test.ts. */
import crypto from 'node:crypto'
import { SEARCH_KEY_FIELDS, DEFAULT_ENDPOINTS } from '../src/shared/websearch'
import { defaultBaseURL } from '../src/shared/providers'

export const SENTINEL_PREFIX = 'tqsk_'
export const IMPORT_PREFIX = 'tqsk_imp_'
const SENTINEL_RE = /tqsk_(?:imp_)?[a-z0-9]{24}/g
export const isSentinel = (v: unknown) => typeof v === 'string' && /^tqsk_(?:imp_)?[a-z0-9]{24}$/.test(v)
const salt = crypto.randomBytes(16).toString('hex') // per app run: sentinels are not stable across restarts or guessable
export function sentinelFor(path: string) { return SENTINEL_PREFIX + crypto.createHash('sha256').update(salt + path).digest('hex').slice(0, 24) }

const hostOf = (u: string) => { try { return new URL(u).host.toLowerCase() } catch { return '' } }
const SEARCH_ENDPOINT_OF: Record<string, 'tavily' | 'bing' | 'brave'> = { tavilyKey: 'tavily', bingKey: 'bing', braveKey: 'brave' }

export interface SecretSlot { path: string; value: string; url: string }
/** every secret slot of a (plaintext) settings object with the URL it is used for */
export function secretSlots(s: any): SecretSlot[] {
  if (!s) return []
  const out: SecretSlot[] = []
  for (const p of s.providers || []) out.push({ path: `providers/${p.id}/apiKey`, value: String(p.apiKey || ''), url: p.baseURL || defaultBaseURL(p.type) })
  if (s.webdav) out.push({ path: 'webdav/password', value: String(s.webdav.password || ''), url: s.webdav.url || '' })
  for (const f of SEARCH_KEY_FIELDS) { const ep = SEARCH_ENDPOINT_OF[f]; out.push({ path: `webSearch/${f}`, value: String(s.webSearch?.[f] || ''), url: s.webSearch?.endpoints?.[ep] || DEFAULT_ENDPOINTS[ep] }) }
  return out
}
function setSlot(s: any, path: string, v: string): any {
  const [a, b, c] = path.split('/')
  if (a === 'providers') return { ...s, providers: (s.providers || []).map((p: any) => p.id === b && c === 'apiKey' ? { ...p, apiKey: v } : p) }
  if (a === 'webdav' && b === 'password') return { ...s, webdav: { ...(s.webdav || {}), password: v } }
  if (a === 'webSearch' && (SEARCH_KEY_FIELDS as readonly string[]).includes(b)) return { ...s, webSearch: { ...(s.webSearch || {}), [b]: v } }
  return s
}
export const validPath = (s: any, path: string) => secretSlots(s).some(x => x.path === path)

export interface VaultMeta { hosts: Record<string, string> }
/** host each saved secret may be sent to; filled for secrets without a binding (migration from 1.0.1) */
export function bindHosts(plain: any, meta: VaultMeta = { hosts: {} }): VaultMeta {
  const hosts: Record<string, string> = {}
  for (const sl of secretSlots(plain)) if (sl.value) hosts[sl.path] = meta.hosts?.[sl.path] || hostOf(sl.url)
  return { hosts }
}

/** settings for the renderer: every saved secret replaced by its sentinel ('' stays '') */
export function redactForRenderer(plain: any): any {
  let out = plain
  for (const sl of secretSlots(plain)) if (sl.value) out = setSlot(out, sl.path, sentinelFor(sl.path))
  return out
}

/** settings coming back from the renderer: secrets are never taken from it except
 *  - a sentinel for the SAME slot keeps the stored value,
 *  - an import sentinel (from a backup opened through main) takes the stashed value,
 *  - a plain value (legacy callers) is accepted, since the renderer evidently already had it.
 *  '' or a sentinel of another slot keeps the stored value (a renderer cannot move a key to another provider). */
export function mergeFromRenderer(incoming: any, stored: any, stash: Map<string, string>, meta: VaultMeta): { settings: any; meta: VaultMeta } {
  if (!incoming || typeof incoming !== 'object') return { settings: incoming, meta }
  const storedBy = new Map(secretSlots(stored).map(x => [x.path, x.value]))
  let out = incoming
  const hosts = { ...(meta.hosts || {}) }
  for (const sl of secretSlots(incoming)) {
    const v = sl.value, old = storedBy.get(sl.path) || ''
    let next = old
    if (v.startsWith(IMPORT_PREFIX) && stash.has(v)) { next = stash.get(v)!; hosts[sl.path] = hostOf(sl.url) }
    else if (v && !v.startsWith(SENTINEL_PREFIX)) { next = v; hosts[sl.path] = hostOf(sl.url) }
    out = setSlot(out, sl.path, next)
    if (!next) delete hosts[sl.path]
    else if (!hosts[sl.path]) hosts[sl.path] = hostOf(sl.url) // saved before its URL was filled in: bind to the first URL
  }
  for (const k of Object.keys(hosts)) if (!secretSlots(out).some(x => x.path === k && x.value)) delete hosts[k]
  return { settings: out, meta: { hosts } }
}

/** set / clear one secret (renderer "save" / "clear" buttons) */
export function setSecret(stored: any, meta: VaultMeta, path: string, value: string): { settings: any; meta: VaultMeta; sentinel: string } {
  if (!validPath(stored, path)) throw new Error('unknown secret slot')
  const v = String(value || '').trim()
  const settings = setSlot(stored, path, v)
  const hosts = { ...(meta.hosts || {}) }
  if (v) hosts[path] = hostOf(secretSlots(settings).find(x => x.path === path)!.url); else delete hosts[path]
  return { settings, meta: { hosts }, sentinel: v ? sentinelFor(path) : '' }
}

export interface OutReq { url: string; headers?: Record<string, string>; body?: string }
/** replace sentinels in an outgoing bridge request. Only secrets bound to the request's host are inserted;
 *  a sentinel for another host makes the request fail (returns an error instead of leaking or sending garbage). */
export function resolveRequest(req: OutReq, plain: any, meta: VaultMeta): { req: OutReq; error?: string; used: string[] } {
  const byS = new Map(secretSlots(plain).filter(x => x.value).map(x => [sentinelFor(x.path), x]))
  const host = hostOf(req.url)
  const used: string[] = []
  let error: string | undefined
  const sub = (text: string, enc: (v: string) => string) => text.replace(SENTINEL_RE, s => {
    const sl = byS.get(s)
    if (!sl) return s
    const bound = meta.hosts?.[sl.path] || hostOf(sl.url)
    if (bound !== host) { error = `The saved secret for ${sl.path} is bound to ${bound}; it is not sent to ${host}. Re-enter it after changing the address.`; return '' }
    used.push(sl.path); return enc(sl.value)
  })
  const url = sub(req.url, encodeURIComponent)
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers || {})) {
    const m = /^Basic\s+(.+)$/i.exec(String(v))
    if (m) { let dec = ''; try { dec = Buffer.from(m[1], 'base64').toString('utf8') } catch { /* not base64 */ }
      if (dec && SENTINEL_RE.test(dec)) { SENTINEL_RE.lastIndex = 0; headers[k] = 'Basic ' + Buffer.from(sub(dec, x => x), 'utf8').toString('base64'); continue } SENTINEL_RE.lastIndex = 0 }
    headers[k] = sub(String(v), x => x)
  }
  const body = typeof req.body === 'string' ? sub(req.body, x => JSON.stringify(x).slice(1, -1)) : req.body
  return { req: { ...req, url, headers, body }, error, used }
}

/** backup file written by main: sentinels of saved secrets become the real values (only when the user chose
 *  "include keys"); used only for files the user picks in the save dialog */
export function resolveInText(text: string, plain: any): string {
  const byS = new Map(secretSlots(plain).filter(x => x.value).map(x => [sentinelFor(x.path), x.value]))
  return text.replace(SENTINEL_RE, s => byS.has(s) ? JSON.stringify(byS.get(s)).slice(1, -1) : s)
}

/** backup file read by main: secrets inside are stashed and replaced by import sentinels before the renderer sees it */
export function stashBackupSecrets(text: string, stash: Map<string, string>): string {
  let j: any
  try { j = JSON.parse(text) } catch { return text }
  const s = j?.data?.settings
  if (!s || typeof s !== 'object') return text
  let out = s
  for (const sl of secretSlots(s)) {
    if (!sl.value || isSentinel(sl.value)) continue
    const id = IMPORT_PREFIX + crypto.randomBytes(12).toString('hex')
    stash.set(id, sl.value); out = setSlot(out, sl.path, id)
  }
  return JSON.stringify({ ...j, data: { ...j.data, settings: out } })
}
