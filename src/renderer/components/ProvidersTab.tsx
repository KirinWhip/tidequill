import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Plus, PlugZap, RefreshCw, Search, Trash2, X, XCircle } from 'lucide-react'
import type { ProviderConfig, Settings } from '../../shared/types'
import type { Dict } from '../i18n'
import type { AppActions } from '../App'
import { uid } from '../../shared/storage'
import { defaultBaseURL, listModels } from '../../shared/providers'
import { api, bridgeFetch } from '../api'
import { SecretField } from './SecretField'
import { ProviderError } from '../../shared/errors'

export type ProvStatus = { state: 'nokey' | 'untested' | 'checking' | 'ok' | 'fail'; detail?: string; count?: number; at?: number }
const errText = (t: Dict, e: any) => e instanceof ProviderError ? `${(t as any)['err_' + e.code] || t.err_unknown}${e.detail ? ' (' + e.detail.slice(0, 120) + ')' : ''}` : t.err_unknown
const needsKey = (p: ProviderConfig) => p.type !== 'ollama'

/** connection status survives closing the settings panel (per app session) */
const statusCache: Record<string, ProvStatus> = {}

export function ProvidersTab({ s, t, set, actions, secure }: { s: Settings; t: Dict; set(p: Partial<Settings>): void; actions: AppActions; secure: boolean }) {
  const [sel, setSel] = useState(s.providers[0]?.id)
  const prov = s.providers.find(p => p.id === sel)
  const setProv = (id: string, p: Partial<ProviderConfig>) => set({ providers: s.providers.map(x => x.id === id ? { ...x, ...p } : x) })
  const [status, setStatus] = useState<Record<string, ProvStatus>>({ ...statusCache })
  const [secretHosts, setSecretHosts] = useState<Record<string, { host: string }>>({})
  const refreshSecrets = () => api.secretStatus?.().then((x: any) => setSecretHosts(x || {}))
  useEffect(() => { refreshSecrets() }, [])
  const [filter, setFilter] = useState('')
  const [newModel, setNewModel] = useState('')
  const [fetchMsg, setFetchMsg] = useState<any>('')
  const providersRef = useRef(s.providers); providersRef.current = s.providers
  useEffect(() => { setFilter(''); setFetchMsg('') }, [sel])

  const put = (id: string, st: ProvStatus) => { statusCache[id] = st; setStatus(x => ({ ...x, [id]: st })) }
  const statusOf = (p: ProviderConfig): ProvStatus => status[p.id] || (needsKey(p) && !p.apiKey ? { state: 'nokey' } : { state: 'untested' })
  /** real connection test: lists models with the current key / URL */
  const test = async (p: ProviderConfig) => {
    if (needsKey(p) && !p.apiKey) { put(p.id, { state: 'nokey' }); return }
    put(p.id, { state: 'checking' })
    try { const m = await listModels(p, bridgeFetch); put(p.id, { state: 'ok', count: m.length, at: Date.now() }) }
    catch (e: any) { put(p.id, { state: 'fail', detail: errText(t, e), at: Date.now() }) }
  }
  // probe configured providers once when the tab opens, so badges reflect the real connection state
  useEffect(() => { for (const p of s.providers) if (!statusCache[p.id] && (p.apiKey || p.type === 'ollama')) test(p) }, [])

  const badge = (p: ProviderConfig) => {
    const st = statusOf(p)
    // B7: 未配置 / 已配置 / 连接正常 / 连接失败, last test time in the tooltip, Ollama probed via /api/tags
    const when = st.at ? '\n' + t.provLastTest.replace('{time}', new Date(st.at).toLocaleString()) : ''
    const tip = (st.state === 'ok' ? t.provOkTip.replace('{n}', String(st.count ?? 0))
      : st.state === 'fail' ? `${t.provFail}: ${st.detail || ''}` : st.state === 'nokey' ? t.provNoKeyTip : st.state === 'checking' ? t.provChecking : t.provConfiguredTip)
      + when + (p.type === 'ollama' ? '\n' + t.provOllamaTip.replace('{url}', (p.baseURL || 'http://localhost:11434').replace(/\/+$/, '').replace(/\/v1$/, '')) : '')
    return <span className={'sbadge ' + st.state} data-testid={`badge-${p.id}`} data-state={st.state} data-tip={tip} aria-label={tip}>
      {st.state === 'checking' ? <Loader2 size={11} className="spin" /> : <span className="dot" />}
      {({ ok: t.provConnected, fail: t.provFail, nokey: t.provNotConfigured, untested: t.provConfigured, checking: t.provChecking } as any)[st.state]}</span>
  }
  const shown = useMemo(() => (prov?.models || []).filter(m => m.toLowerCase().includes(filter.toLowerCase())), [prov, filter])
  const hidden = new Set(prov?.hiddenModels || [])
  const addModel = () => {
    const m = newModel.trim(); if (!prov || !m) return
    if (!prov.models.includes(m)) setProv(prov.id, { models: [...prov.models, m] })
    setNewModel('')
  }
  const st = prov ? statusOf(prov) : undefined
  const defProv = s.providers.find(p => p.id === s.defaultProviderId)

  return <div className="split">
    <div className="plist">
      {s.providers.map(p => <div key={p.id} className={'pitem' + (p.id === sel ? ' on' : '')} onClick={() => setSel(p.id)}><span className="pname">{p.name}</span>{badge(p)}</div>)}
      <button onClick={() => { const id = uid(); set({ providers: [...s.providers, { id, name: t.customProvider, type: 'openai', apiKey: '', baseURL: 'https://', models: [] }] }); setSel(id) }}><Plus size={14} />{t.addProvider}</button>
      <button data-testid="ollama-detect" onClick={async () => {
        const ol = providersRef.current.find(p => p.type === 'ollama'); if (ol) put(ol.id, { state: 'checking' })
        const r = await actions.detectOllama()
        if (ol) put(ol.id, r.ok ? { state: 'ok', count: r.count, at: Date.now() } : { state: 'fail', detail: t.ollamaNotFound.replace('{url}', r.url), at: Date.now() })
        setFetchMsg(r.ok ? <span className="okmsg" data-testid="settings-msg"><Check size={14} />{t.ollamaFound + r.count}</span> : <span className="errmsg" data-testid="settings-msg"><XCircle size={14} />{t.ollamaNotFound.replace('{url}', r.url)}</span>)
      }}><Search size={14} />{t.ollamaDetect}</button>
    </div>
    {prov && <div className="form">
      <div className="row"><label className="grow">{t.name}<input value={prov.name} onChange={e => setProv(prov.id, { name: e.target.value })} /></label>
        <label>{t.type}<select value={prov.type} onChange={e => setProv(prov.id, { type: e.target.value as any, baseURL: defaultBaseURL(e.target.value as any) })}>
          <option value="openai">{t.typeOpenAI}</option><option value="anthropic">{t.typeAnthropic}</option><option value="gemini">{t.typeGemini}</option><option value="ollama">{t.typeOllama}</option></select></label></div>
      <label>{t.apiKey}
        <SecretField key={prov.id} path={`providers/${prov.id}/apiKey`} value={prov.apiKey} testid="api-key" placeholder={needsKey(prov) ? 'sk-…' : t.apiKeyOptional}
          onSaved={v => { setProv(prov.id, { apiKey: v }); put(prov.id, { state: v || !needsKey(prov) ? 'untested' : 'nokey' }); refreshSecrets() }} />
        {(() => { const b = secretHosts[`providers/${prov.id}/apiKey`]?.host; let h = ''; try { h = new URL(prov.baseURL).host } catch { /* invalid url */ }
          return prov.apiKey && b && h && b !== h ? <small className="warn" data-testid="key-host-changed">{t.secretHostChanged.replace('{host}', b)}</small> : null })()}
        <small className={secure ? '' : 'warn'}>{secure ? t.secretHint : t.apiKeyPlainWarn}</small></label>
      <label>{t.baseURL}<input value={prov.baseURL} onChange={e => { setProv(prov.id, { baseURL: e.target.value }); put(prov.id, { state: 'untested' }) }} /></label>
      <div className="row testrow">
        <button data-testid="test-conn" disabled={st?.state === 'checking'} onClick={() => test(prov)}><PlugZap size={14} />{t.onbTest}</button>
        <span data-testid="test-result" className={st?.state === 'ok' ? 'okmsg' : st?.state === 'fail' ? 'errmsg' : 'meta'}>
          {st?.state === 'ok' && <><Check size={14} />{t.provOkTip.replace('{n}', String(st.count ?? 0))}</>}
          {st?.state === 'fail' && <><XCircle size={14} />{st.detail}</>}
          {st?.state === 'checking' && <><Loader2 size={14} className="spin" />{t.provChecking}</>}
          {st?.state === 'nokey' && t.provNoKeyTip}
          {st?.at && st.state !== 'checking' && <span className="meta" data-testid="last-test"> · {t.provLastTest.replace('{time}', new Date(st.at).toLocaleString())}</span>}
        </span>
      </div>

      <div className="fieldhead"><span>{t.models} <span className="meta">({prov.models.length - prov.models.filter(m => hidden.has(m)).length}/{prov.models.length} {t.modelsShown})</span></span>
        <span className="spacer" />
        <button data-testid="fetch-models" onClick={async () => { setFetchMsg(<Loader2 size={14} className="spin" />); try { const m = await listModels(prov, bridgeFetch); setProv(prov.id, { models: [...new Set([...prov.models, ...m])] }); put(prov.id, { state: 'ok', count: m.length, at: Date.now() }); setFetchMsg(<span className="okmsg" data-testid="settings-msg"><Check size={14} />{t.fetchedModels.replace('{n}', String(m.length))}</span>) } catch (e: any) { put(prov.id, { state: 'fail', detail: errText(t, e), at: Date.now() }); setFetchMsg(<span className="errmsg" data-testid="settings-msg"><XCircle size={14} />{errText(t, e)}</span>) } }}><RefreshCw size={14} />{t.fetchModels}</button>
      </div>
      {fetchMsg && <div className="settings-msg inline">{fetchMsg}</div>}
      <div className="chipsbox">
        <div className="row"><div className="searchbox sm"><Search size={13} /><input data-testid="model-filter" placeholder={t.filterModels} aria-label={t.filterModels} value={filter} onChange={e => setFilter(e.target.value)} /></div>
          <input data-testid="model-add" placeholder={t.addModelPh} aria-label={t.addModel} value={newModel} onChange={e => setNewModel(e.target.value)} onKeyDown={e => e.key === 'Enter' && addModel()} />
          <button className="icon-btn" title={t.addModel} aria-label={t.addModel} onClick={addModel}><Plus size={15} /></button></div>
        <div className="chips" data-testid="model-chips">
          {shown.map(m => <span key={m} className={'mchip' + (hidden.has(m) ? '' : ' on')} data-model={m}>
            <label title={hidden.has(m) ? t.modelHiddenTip : t.modelShownTip}><input type="checkbox" checked={!hidden.has(m)} onChange={() => setProv(prov.id, { hiddenModels: hidden.has(m) ? [...hidden].filter(x => x !== m) : [...hidden, m] })} />{m}</label>
            <button className="x" title={t.removeModel} aria-label={`${t.removeModel} ${m}`} onClick={() => setProv(prov.id, { models: prov.models.filter(x => x !== m), hiddenModels: [...hidden].filter(x => x !== m) })}><X size={12} /></button>
          </span>)}
          {!shown.length && <span className="meta">{prov.models.length ? t.noMatch : t.noModelsYet}</span>}
        </div>
      </div>

      <div className="defaultbox" data-testid="default-model">
        <div className="fieldhead"><span>{t.defaultModel}</span></div>
        <div className="row"><select title={t.provider} aria-label={t.provider} value={s.defaultProviderId} onChange={e => set({ defaultProviderId: e.target.value })}>{s.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input aria-label={t.defaultModel} list="defmodels" value={s.defaultModel} onChange={e => set({ defaultModel: e.target.value })} />
          <datalist id="defmodels">{(defProv?.models || []).map(m => <option key={m} value={m} />)}</datalist></div>
        <small className="meta">{t.defaultModelRule}</small>
      </div>

      <div className="dangerzone">
        <span className="meta">{t.deleteProviderHint}</span><span className="spacer" />
        <button className="danger" data-testid="delete-provider" onClick={() => { if (!confirm(t.confirmDeleteProvider.replace('{name}', prov.name))) return; const rest = s.providers.filter(x => x.id !== prov.id); set({ providers: rest }); setSel(rest[0]?.id) }}><Trash2 size={14} />{t.deleteProvider}</button>
      </div>
    </div>}
  </div>
}
