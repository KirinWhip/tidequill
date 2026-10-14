import { useEffect, useState } from 'react'
import { Check, XCircle, Loader2, Eye, EyeOff, Download, Lock } from 'lucide-react'
import type { Settings } from '../../shared/types'
import type { Dict } from '../i18n'
import { SEARCH_PROVIDERS, DEFAULT_ENDPOINTS, webSearch, SearchError, type SearchProviderId, type WebSearchConfig } from '../../shared/websearch'
import { DEFAULT_STT } from '../../shared/stt'
import { DEFAULT_OCR_SOURCE } from '../../shared/storage'
import { fmtBytes } from '../../shared/office'
import { api, bridgeFetch } from '../api'
import { SecretField } from './SecretField'

const KEY_FIELD: Partial<Record<SearchProviderId, 'tavilyKey' | 'bingKey' | 'braveKey'>> = { tavily: 'tavilyKey', bing: 'bingKey', brave: 'braveKey' }

/** Settings > Web search */
export function SearchTab({ s, t, set, secure }: { s: Settings; t: Dict; set(p: Partial<Settings>): void; secure: boolean }) {
  const ws: WebSearchConfig = s.webSearch!
  const setWs = (p: Partial<WebSearchConfig>) => set({ webSearch: { ...ws, ...p } })
  const [show, setShow] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setRes(null), [ws.provider])
  const kf = KEY_FIELD[ws.provider]
  const test = async () => {
    setBusy(true); setRes(null)
    try { const r = await webSearch(ws, t.searchTestQuery, bridgeFetch); setRes({ ok: true, text: t.searchTestOk.replace('{n}', String(r.length)) }) }
    catch (e: any) { setRes({ ok: false, text: `${e instanceof SearchError ? (t as any)['searchErr_' + e.code] : t.searchErr_network} (${String(e?.message || e).slice(0, 160)})` }) }
    finally { setBusy(false) }
  }
  return (
    <div className="form" data-testid="search-settings">
      <label className="check"><input type="checkbox" data-testid="search-enabled" checked={!!s.chatDefaults?.webSearch} onChange={e => set({ chatDefaults: { ...{ reasoning: false, tools: false }, ...(s.chatDefaults || {}), webSearch: e.target.checked } })} /> {t.chatDefaultsTitle}: {t.webSearch}</label>
      <div className="meta">{t.webSearchTip3}</div>
      <label>{t.searchProvider}<div className="seg" role="radiogroup" aria-label={t.searchProvider}>
        {SEARCH_PROVIDERS.map(p => <button key={p} role="radio" aria-checked={ws.provider === p} data-provider={p} className={ws.provider === p ? 'on' : ''} onClick={() => setWs({ provider: p })}>{t[('sp_' + p) as 'sp_tavily']}</button>)}
      </div></label>
      {ws.provider === 'bing' && <div className="meta warnline" data-testid="bing-note">{t.bingHint}</div>}
      {kf && <label>{t.searchKey}<SecretField key={kf} path={`webSearch/${kf}`} value={ws[kf]} testid="search-key" onSaved={v => setWs({ [kf]: v } as any)} /></label>}
      {ws.provider === 'searxng' && <><label>{t.searxngUrl}<input data-testid="searxng-url" value={ws.searxngUrl} placeholder={SEARXNG_PH} onChange={e => setWs({ searxngUrl: e.target.value.trim() })} /></label>
        <div className="meta">{t.searxngHint}</div></>}
      {ws.provider !== 'searxng' && <label>{t.endpointOverride}<input data-testid="search-endpoint" value={ws.endpoints?.[ws.provider] || ''} placeholder={DEFAULT_ENDPOINTS[ws.provider as 'tavily']}
        onChange={e => setWs({ endpoints: { ...(ws.endpoints || {}), [ws.provider]: e.target.value.trim() } })} /></label>}
      <label>{t.maxResults}<input type="number" min={1} max={20} value={ws.maxResults} onChange={e => setWs({ maxResults: Math.max(1, Math.min(20, +e.target.value || 5)) })} /></label>
      <div className="row">
        <button className="btn" data-testid="search-test" disabled={busy} onClick={test}>{busy ? <Loader2 size={14} className="spin" /> : null}{t.searchTest}</button>
        {res && <span className={res.ok ? 'okmsg' : 'errmsg'} data-testid="search-test-result">{res.ok ? <Check size={14} /> : <XCircle size={14} />}{res.text}</span>}
      </div>
      {kf && secure && <div className="meta"><Lock size={12} /> {t.searchKeysEncrypted}</div>}
      <div className="meta">{t.searchHowItWorks}</div>
    </div>
  )
}

/** example values (not translatable) */
const SEARXNG_PH = 'http://localhost:8080', STT_LANG_PH = 'zh'
const OCR_LANGS = ['eng', 'chi_sim', 'chi_tra', 'jpn']

/** Settings > Chat: attachment limits, OCR, voice input */
export function ChatExtras({ s, t, set }: { s: Settings; t: Dict; set(p: Partial<Settings>): void }) {
  const ocr = s.ocr || { enabled: false, langs: ['eng', 'chi_sim'], source: DEFAULT_OCR_SOURCE }
  const stt = s.stt || DEFAULT_STT
  const [sizes, setSizes] = useState<Record<string, number>>({})
  const [dl, setDl] = useState<Record<string, string>>({})
  const refresh = () => api.ocrStatus?.(OCR_LANGS).then(setSizes)
  useEffect(() => { refresh() }, [])
  const download = async (l: string) => {
    setDl(x => ({ ...x, [l]: 'busy' }))
    const r = await api.ocrDownload(l, ocr.source || DEFAULT_OCR_SOURCE)
    setDl(x => ({ ...x, [l]: r.ok ? '' : r.error })); refresh()
  }
  const openai = s.providers.filter(p => p.type === 'openai')
  return (
    <>
      <h3>{t.attach}</h3>
      <label>{t.maxAttachmentMB}<input type="number" data-testid="max-att-mb" min={1} max={500} value={s.maxAttachmentMB ?? 20} onChange={e => set({ maxAttachmentMB: Math.max(1, +e.target.value || 20) })} /></label>
      <label>{t.maxAttachmentChars}<input type="number" min={1000} step={1000} value={s.maxAttachmentChars ?? 200000} onChange={e => set({ maxAttachmentChars: Math.max(1000, +e.target.value || 200000) })} /></label>
      <h3>{t.ocr}</h3>
      <label className="check"><input type="checkbox" data-testid="ocr-enabled" checked={ocr.enabled} onChange={e => set({ ocr: { ...ocr, enabled: e.target.checked } })} /> {t.ocrEnable}</label>
      <div className="meta">{t.ocrHint}</div>
      <div className="ocrlangs" data-testid="ocr-langs">{OCR_LANGS.map(l => <div key={l} className="ocrlang" data-lang={l}>
        <label className="check"><input type="checkbox" checked={ocr.langs.includes(l)} onChange={e => set({ ocr: { ...ocr, langs: e.target.checked ? [...ocr.langs, l] : ocr.langs.filter(x => x !== l) } })} /> {(t as any)['lang_' + l]} <code>{l}</code></label>
        <span className={'meta' + (sizes[l] ? ' okmsg' : '')} data-testid={`ocr-state-${l}`}>{sizes[l] ? t.ocrDownloaded.replace('{size}', fmtBytes(sizes[l])) : t.ocrMissing}</span>
        <button className="btn sm" data-testid={`ocr-dl-${l}`} disabled={dl[l] === 'busy'} onClick={() => download(l)}>{dl[l] === 'busy' ? <Loader2 size={13} className="spin" /> : <Download size={13} />}{t.ocrDownload}</button>
        {dl[l] && dl[l] !== 'busy' && <span className="errmsg"><XCircle size={13} />{dl[l]}</span>}
      </div>)}</div>
      <label>{t.ocrSource}<input data-testid="ocr-source" value={ocr.source} onChange={e => set({ ocr: { ...ocr, source: e.target.value.trim() } })} /></label>
      <h3>{t.stt}</h3>
      <label className="check"><input type="checkbox" data-testid="stt-enabled" checked={stt.enabled} onChange={e => set({ stt: { ...stt, enabled: e.target.checked } })} /> {t.sttEnable}</label>
      <div className="meta">{t.sttHint}</div>
      <label>{t.sttProvider}<select data-testid="stt-provider" value={stt.providerId} onChange={e => set({ stt: { ...stt, providerId: e.target.value } })}>
        <option value="">{"—"}</option>
        {openai.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <label>{t.sttModel}<input data-testid="stt-model" value={stt.model} placeholder={DEFAULT_STT.model} onChange={e => set({ stt: { ...stt, model: e.target.value.trim() } })} /></label>
      <label>{t.sttLanguage}<input value={stt.language} placeholder={STT_LANG_PH} onChange={e => set({ stt: { ...stt, language: e.target.value.trim() } })} /></label>
    </>
  )
}
