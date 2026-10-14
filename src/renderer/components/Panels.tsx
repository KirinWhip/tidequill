import { useEffect, useState } from 'react'
import { Plus, Check, XCircle, Download, Upload, Trash2, Loader2, Search, RefreshCw } from 'lucide-react'
import type { AppActions } from '../App'
import { DEFAULT_PRICES } from '../../shared/usage'
import { webdavTest } from '../webdav'
import type { GalleryImage, McpServerConfig, Persona, PromptItem, ProviderConfig, Settings } from '../../shared/types'
import type { Dict } from '../i18n'
import { uid } from '../../shared/storage'
import { defaultBaseURL, generateImage, listModels } from '../../shared/providers'
import { api, bridgeFetch } from '../api'
import { ProviderError } from '../../shared/errors'

const errText = (t: Dict, e: any) => e instanceof ProviderError ? `${(t as any)['err_' + e.code] || t.err_unknown}${e.detail ? ' (' + e.detail.slice(0, 120) + ')' : ''}` : t.err_unknown

export function SettingsPanel({ s, t, onChange, actions }: { s: Settings; t: Dict; onChange(s: Settings): void; actions: AppActions }) {
  type Tab = 'providers' | 'chat' | 'network' | 'usageSettings' | 'data' | 'systemTab' | 'general' | 'shortcuts'
  const [tab, setTab] = useState<Tab>('providers')
  const set = (p: Partial<Settings>) => onChange({ ...s, ...p })
  const setProv = (id: string, p: Partial<ProviderConfig>) => set({ providers: s.providers.map(x => x.id === id ? { ...x, ...p } : x) })
  const [sel, setSel] = useState(s.providers[0]?.id)
  const prov = s.providers.find(p => p.id === sel)
  const [msg, setMsg] = useState<any>('')
  const [secure, setSecure] = useState(true)
  const [version, setVersion] = useState('')
  const [includeKeys, setIncludeKeys] = useState(false)
  useEffect(() => { api.secureStatus().then((r: any) => setSecure(!!r.available)); api.version().then(setVersion) }, [])
  useEffect(() => setMsg(''), [tab, sel])
  const busy = () => setMsg(<Loader2 size={14} className="spin" />)
  const ok = (x: any) => setMsg(<span className="okmsg" data-testid="settings-msg"><Check size={14} />{x}</span>)
  const fail = (x: any) => setMsg(<span className="errmsg" data-testid="settings-msg"><XCircle size={14} />{x}</span>)
  const wd = s.webdav
  const setWd = (p: Partial<Settings['webdav']>) => set({ webdav: { ...wd, ...p } })
  const tabs: Tab[] = ['providers', 'chat', 'network', 'usageSettings', 'data', 'systemTab', 'general', 'shortcuts']
  const sys = actions.systemStatus || {}
  return (
    <div className="panel">
      <h2>{t.settings}</h2>
      <div className="tabs">{tabs.map(k => <button key={k} data-tab={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t[k]}</button>)}</div>
      {tab === 'providers' && <div className="split">
        <div className="plist">
          {s.providers.map(p => <div key={p.id} className={'pitem' + (p.id === sel ? ' on' : '')} onClick={() => setSel(p.id)}>{p.name} {(p.apiKey || p.type === 'ollama') && <Check size={13} className="ok-icon" aria-label={t.apiKey} />}</div>)}
          <button onClick={() => { const id = uid(); set({ providers: [...s.providers, { id, name: t.customProvider, type: 'openai', apiKey: '', baseURL: 'https://', models: [] }] }); setSel(id) }}><Plus size={14} />{t.addProvider}</button>
          <button data-testid="ollama-detect" onClick={async () => { busy(); const r = await actions.detectOllama(); r.ok ? ok(t.ollamaFound + r.count) : fail(t.ollamaNotFound.replace('{url}', r.url)) }}><Search size={14} />{t.ollamaDetect}</button>
        </div>
        {prov && <div className="form">
          <label>{t.name}<input value={prov.name} onChange={e => setProv(prov.id, { name: e.target.value })} /></label>
          <label>{t.type}<select value={prov.type} onChange={e => setProv(prov.id, { type: e.target.value as any, baseURL: defaultBaseURL(e.target.value as any) })}>
            <option value="openai">{t.typeOpenAI}</option><option value="anthropic">{t.typeAnthropic}</option><option value="gemini">{t.typeGemini}</option><option value="ollama">{t.typeOllama}</option></select></label>
          <label>{t.apiKey}<input type="password" value={prov.apiKey} onChange={e => setProv(prov.id, { apiKey: e.target.value })} /><small className={secure ? '' : 'warn'}>{secure ? t.apiKeyHint : t.apiKeyPlainWarn}</small></label>
          <label>{t.baseURL}<input value={prov.baseURL} onChange={e => setProv(prov.id, { baseURL: e.target.value })} /></label>
          <label>{t.models}<textarea rows={3} value={prov.models.join(', ')} onChange={e => setProv(prov.id, { models: e.target.value.split(/[,\n]/).map(x => x.trim()).filter(Boolean) })} /></label>
          <div className="row">
            <button onClick={async () => { busy(); try { const m = await listModels(prov, bridgeFetch); setProv(prov.id, { models: m }); ok(m.length) } catch (e: any) { fail(errText(t, e)) } }}>{t.fetchModels}</button>
            <button className="danger" onClick={() => { set({ providers: s.providers.filter(x => x.id !== prov.id) }); setSel(s.providers[0]?.id) }}>{t.delete}</button>
          </div>
          <label>{t.defaultModel}<div className="row"><select title={t.provider} value={s.defaultProviderId} onChange={e => set({ defaultProviderId: e.target.value })}>{s.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <input value={s.defaultModel} onChange={e => set({ defaultModel: e.target.value })} /></div></label>
        </div>}
      </div>}
      {tab === 'chat' && <div className="form">
        <label>{t.temperature}: {s.temperature}<input type="range" min={0} max={2} step={0.1} value={s.temperature} onChange={e => set({ temperature: +e.target.value })} /></label>
        <label>{t.topP}: {s.topP}<input type="range" min={0} max={1} step={0.05} value={s.topP} onChange={e => set({ topP: +e.target.value })} /></label>
        <label>{t.maxTokens}<input type="number" value={s.maxTokens} onChange={e => set({ maxTokens: +e.target.value })} /></label>
        <label>{t.contextLength}: {s.contextLength}<input type="range" min={1} max={100} value={s.contextLength} onChange={e => set({ contextLength: +e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={s.toolsEnabled} onChange={e => set({ toolsEnabled: e.target.checked })} /> {t.toolsEnabled}</label>
      </div>}
      {tab === 'network' && <div className="form">
        <label>{t.proxy}<input value={s.proxy} placeholder={t.proxyExample} onChange={e => set({ proxy: e.target.value })} /></label>
        <label>{t.requestTimeout}<input type="number" min={1} value={s.requestTimeout} onChange={e => set({ requestTimeout: +e.target.value })} /></label>
        <label>{t.retries}<input type="number" min={0} max={10} value={s.retries} onChange={e => set({ retries: Math.max(0, +e.target.value) })} /></label>
        <label>{t.retryBaseMs}<input type="number" min={0} step={100} value={s.retryBaseMs} onChange={e => set({ retryBaseMs: Math.max(0, +e.target.value) })} /></label>
      </div>}
      {tab === 'usageSettings' && <div className="form">
        <label className="check"><input type="checkbox" checked={s.showUsage} onChange={e => set({ showUsage: e.target.checked })} /> {t.showUsage}</label>
        <div className="meta">{t.priceTable}</div>
        <table className="pricetable"><thead><tr><th>{t.pricePattern}</th><th>{t.priceInput}</th><th>{t.priceOutput}</th><th /></tr></thead><tbody>
          {s.prices.map((p, i) => <tr key={i}>
            <td><input aria-label={t.pricePattern} value={p.pattern} onChange={e => set({ prices: s.prices.map((x, j) => j === i ? { ...x, pattern: e.target.value } : x) })} /></td>
            <td><input aria-label={t.priceInput} type="number" step="0.01" value={p.input} onChange={e => set({ prices: s.prices.map((x, j) => j === i ? { ...x, input: +e.target.value } : x) })} /></td>
            <td><input aria-label={t.priceOutput} type="number" step="0.01" value={p.output} onChange={e => set({ prices: s.prices.map((x, j) => j === i ? { ...x, output: +e.target.value } : x) })} /></td>
            <td><button className="icon-btn sm" title={t.delete} aria-label={t.delete} onClick={() => set({ prices: s.prices.filter((_, j) => j !== i) })}><Trash2 size={13} /></button></td>
          </tr>)}
        </tbody></table>
        <div className="row"><button onClick={() => set({ prices: [{ pattern: '', input: 0, output: 0 }, ...s.prices] })}><Plus size={14} />{t.addPrice}</button>
          <button onClick={() => set({ prices: DEFAULT_PRICES })}>{t.resetPrices}</button></div>
      </div>}
      {tab === 'data' && <div className="form">
        <div className="row"><button data-testid="backup" onClick={() => actions.backup(includeKeys)}><Download size={14} />{t.backup}</button>
          <button data-testid="restore" onClick={() => actions.restore()}><Upload size={14} />{t.restore}</button></div>
        <label className="check"><input type="checkbox" checked={includeKeys} onChange={e => setIncludeKeys(e.target.checked)} /> {t.backupIncludeKeys}</label>
        <h3>{t.webdav}</h3>
        <label className="check"><input type="checkbox" checked={wd.enabled} onChange={e => setWd({ enabled: e.target.checked })} /> {t.webdavEnable}</label>
        <label>{t.webdavUrl}<input value={wd.url} onChange={e => setWd({ url: e.target.value })} /></label>
        <label>{t.webdavUser}<input value={wd.username} onChange={e => setWd({ username: e.target.value })} /></label>
        <label>{t.webdavPass}<input type="password" value={wd.password} onChange={e => setWd({ password: e.target.value })} /></label>
        <div className="row">
          <button data-testid="webdav-test" onClick={async () => { busy(); try { await webdavTest(wd); ok(t.webdavOk) } catch (e: any) { fail(errText(t, e)) } }}>{t.webdavTest}</button>
          <button data-testid="webdav-sync" disabled={!wd.enabled || !wd.url} onClick={async () => { busy(); try { ok(t.webdavSynced + await actions.sync()) } catch (e: any) { fail(errText(t, e)) } }}><RefreshCw size={14} />{t.webdavSync}</button>
        </div>
        {wd.lastSync && <div className="meta">{t.webdavLast}{new Date(wd.lastSync).toLocaleString()}</div>}
      </div>}
      {tab === 'systemTab' && <div className="form">
        <label>{t.globalShortcut}<input value={s.globalShortcut} onChange={e => set({ globalShortcut: e.target.value })} />
          {s.globalShortcut && sys.shortcut === false && <small className="warn">{t.globalShortcutFail}</small>}</label>
        <label className="check"><input type="checkbox" checked={s.tray} onChange={e => set({ tray: e.target.checked })} /> {t.trayEnable}</label>
        <label className="check"><input type="checkbox" checked={s.launchAtLogin} disabled={sys.loginSupported === false} onChange={e => set({ launchAtLogin: e.target.checked })} /> {t.launchAtLogin}
          {sys.loginSupported === false && <small className="warn">{t.launchAtLoginUnsupported}</small>}</label>
        <label className="check"><input type="checkbox" checked={s.autoCheckUpdate} onChange={e => set({ autoCheckUpdate: e.target.checked })} /> {t.autoCheckUpdate}</label>
        <div className="row"><span className="meta">{t.currentVersion}{version}</span>
          <button data-testid="check-update" onClick={async () => { busy(); const r = await actions.checkUpdate()
            r.status === 'available' ? ok(t.updateAvailable + r.latest) : r.status === 'latest' ? ok(t.updateLatest) : r.status === 'unsupported' ? fail(t.updateUnsupported) : fail(t.updateError + (r.error || '')) }}>{t.checkUpdate}</button></div>
      </div>}
      {tab === 'general' && <div className="form">
        <label>{t.language}<select value={s.language} onChange={e => set({ language: e.target.value as any })}><option value="system">{t.langSystem}</option><option value="zh">{t.langZh}</option><option value="en">{t.langEn}</option></select></label>
        <label>{t.theme}<select value={s.theme} onChange={e => set({ theme: e.target.value as any })}><option value="system">{t.system}</option><option value="light">{t.light}</option><option value="dark">{t.dark}</option></select></label>
        <label>{t.fontSize}: {s.fontSize}px<input type="range" min={12} max={22} value={s.fontSize} onChange={e => set({ fontSize: +e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={s.codeLineNumbers} onChange={e => set({ codeLineNumbers: e.target.checked })} /> {t.codeLineNumbers}</label>
        <label>{t.codeCollapseLines}<input type="number" min={0} value={s.codeCollapseLines} onChange={e => set({ codeCollapseLines: +e.target.value })} /></label>
      </div>}
      {tab === 'shortcuts' && <div className="form">
        <label>{t.sendKey}<select value={s.sendKey} onChange={e => set({ sendKey: e.target.value as any })}><option value="Enter">{t.key_enter}</option><option value="Ctrl+Enter">{t.key_ctrlEnter}</option></select></label>
        <table className="sc"><tbody>
          {([[t.sc_global, s.globalShortcut || '-'], [t.sc_new, `${t.key_ctrl}+N`], [t.sc_search, `${t.key_ctrl}+K`], [t.sc_settings, `${t.key_ctrl}+,`], [t.sc_send, s.sendKey === 'Enter' ? t.key_enter : t.key_ctrlEnter], [t.sc_close, t.key_esc], [t.sc_devtools, t.key_f12]] as const).map(([a, b]) =>
            <tr key={a}><td>{a}</td><td><kbd>{b}</kbd></td></tr>)}
        </tbody></table>
      </div>}
      {msg && <div className="settings-msg">{msg}</div>}
    </div>
  )
}

function ListEditor<T extends { id: string }>({ title, list, onChange, fields, t, extra }: { title: string; list: T[]; onChange(l: T[]): void; fields: [keyof T, string, boolean][]; t: Dict; extra?: (x: T) => any }) {
  const [edit, setEdit] = useState<T | null>(null)
  return (
    <div className="panel">
      <h2>{title}</h2>
      <button className="primary" onClick={() => setEdit({ id: uid(), ...Object.fromEntries(fields.map(f => [f[0], ''])) } as any)}><Plus size={14} />{t.add}</button>
      {edit && <div className="form card">
        {fields.map(([k, label, multi]) => <label key={String(k)}>{label}{multi ? <textarea rows={5} value={String(edit[k] ?? '')} onChange={e => setEdit({ ...edit, [k]: e.target.value })} /> : <input value={String(edit[k] ?? '')} onChange={e => setEdit({ ...edit, [k]: e.target.value })} />}</label>)}
        <div className="row"><button className="primary" onClick={() => { onChange(list.some(x => x.id === edit.id) ? list.map(x => x.id === edit.id ? edit : x) : [...list, edit]); setEdit(null) }}>{t.save}</button><button onClick={() => setEdit(null)}>{t.cancel}</button></div>
      </div>}
      <div className="cards">{list.map(x => <div key={x.id} className="card">
        <b>{String(x[fields[0][0]])}</b><p>{String(x[fields[1][0]]).slice(0, 120)}</p>
        <div className="row">{extra?.(x)}<button onClick={() => setEdit(x)}>{t.edit}</button><button onClick={() => onChange(list.filter(y => y.id !== x.id))}>{t.delete}</button></div>
      </div>)}</div>
    </div>
  )
}

export const PersonasPanel = ({ list, t, onChange, onUse }: { list: Persona[]; t: Dict; onChange(l: Persona[]): void; onUse(p: Persona): void }) =>
  <ListEditor title={t.personas} list={list} onChange={onChange} t={t} fields={[['name', t.name, false], ['prompt', t.systemPrompt, true]]} extra={p => <button className="primary" onClick={() => onUse(p)}>{t.usePersona}</button>} />

export const PromptsPanel = ({ list, t, onChange }: { list: PromptItem[]; t: Dict; onChange(l: PromptItem[]): void }) =>
  <ListEditor title={t.prompts} list={list} onChange={onChange} t={t} fields={[['title', t.name, false], ['content', t.fieldPrompt, true]]} extra={p => <button onClick={() => api.copyText(p.content)}>{t.copy}</button>} />

export function ImagesPanel({ s, t, gallery, onChange }: { s: Settings; t: Dict; gallery: GalleryImage[]; onChange(g: GalleryImage[]): void }) {
  const [prompt, setPrompt] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [size, setSize] = useState('1024x1024'); const [model, setModel] = useState(s.imageModel); const [pid, setPid] = useState(s.imageProviderId)
  const [view, setView] = useState<GalleryImage | null>(null)
  const go = async () => {
    const p = s.providers.find(x => x.id === pid); if (!p || !prompt.trim()) return
    setBusy(true); setErr('')
    try { const urls = await generateImage(p, prompt, model, size, bridgeFetch); onChange([...urls.map(url => ({ id: uid(), prompt, url, createdAt: Date.now() })), ...gallery]) }
    catch (e: any) { setErr(errText(t, e)) } finally { setBusy(false) }
  }
  return (
    <div className="panel">
      <h2>{t.images}</h2>
      <div className="form">
        <textarea rows={3} placeholder={t.imagePrompt} value={prompt} onChange={e => setPrompt(e.target.value)} />
        <div className="row">
          <select title={t.provider} value={pid} onChange={e => setPid(e.target.value)}>{s.providers.filter(p => p.type === 'openai').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input title={t.imageModel} value={model} onChange={e => setModel(e.target.value)} list="imgmodels" /><datalist id="imgmodels"><option value="dall-e-3" /><option value="gpt-image-1" /><option value="dall-e-2" /><option value="grok-2-image" /></datalist>
          <select title={t.imageSize} value={size} onChange={e => setSize(e.target.value)}><option>1024x1024</option><option>1792x1024</option><option>1024x1792</option><option>512x512</option></select>
          <button className="primary" disabled={busy} onClick={go}>{busy ? t.generating : t.generate}</button>
        </div>
        {err && <div className="error">{err}</div>}
      </div>
      <h3>{t.gallery} ({gallery.length})</h3>
      <div className="gallery">{gallery.map(g => <div key={g.id} className="gitem"><img src={g.url} title={g.prompt} onClick={() => setView(g)} />
        <div className="row"><a title={t.download} href={g.url} download={`image-${g.id}.png`} className="icon-btn sm" aria-label={t.download}><Download size={14} /></a><button className="icon-btn sm" title={t.delete} aria-label={t.delete} onClick={() => onChange(gallery.filter(x => x.id !== g.id))}><Trash2 size={14} /></button></div></div>)}</div>
      {view && <div className="lightbox" onClick={() => setView(null)}><img src={view.url} /><p>{view.prompt}</p></div>}
    </div>
  )
}

export function ToolsPanel({ s, t, onChange }: { s: Settings; t: Dict; onChange(s: Settings): void }) {
  const [status, setStatus] = useState<any>({ plugins: [], mcp: [] })
  const [allow, setAllow] = useState<string[]>([])
  const refresh = () => { api.toolStatus().then(setStatus); api.toolAllowlist().then(setAllow) }
  useEffect(() => { refresh(); const i = setInterval(refresh, 1500); return () => clearInterval(i) }, [])
  const setServers = (l: McpServerConfig[]) => onChange({ ...s, mcpServers: l })
  const upd = (id: string, p: Partial<McpServerConfig>) => setServers(s.mcpServers.map(x => x.id === id ? { ...x, ...p } : x))
  return (
    <div className="panel">
      <h2>{t.tools}</h2>
      <label className="check"><input type="checkbox" checked={s.toolsEnabled} onChange={e => onChange({ ...s, toolsEnabled: e.target.checked })} /> {t.toolsEnabled}</label>
      <h3>{t.mcpServers}</h3>
      {s.mcpServers.map(m => { const st = status.mcp.find((x: any) => x.id === m.id); return (
        <div key={m.id} className="card form">
          <div className="row">
            <input value={m.name} onChange={e => upd(m.id, { name: e.target.value })} placeholder={t.name} />
            <select value={m.type} onChange={e => upd(m.id, { type: e.target.value as any })}><option value="stdio">{t.mcpStdio}</option><option value="http">{t.mcpHttp}</option></select>
            <label className="check"><input type="checkbox" checked={m.enabled} onChange={e => upd(m.id, { enabled: e.target.checked })} />{t.enabled}</label>
            <button className="danger" onClick={() => setServers(s.mcpServers.filter(x => x.id !== m.id))}>{t.delete}</button>
          </div>
          {m.type === 'stdio' ? <div className="row">
            <input value={m.command || ''} placeholder={t.command} onChange={e => upd(m.id, { command: e.target.value })} />
            <input value={(m.args || []).join(' ')} placeholder={t.args} onChange={e => upd(m.id, { args: e.target.value.split(' ').filter(Boolean) })} />
          </div> : <input value={m.url || ''} placeholder={t.mcpUrl} onChange={e => upd(m.id, { url: e.target.value })} />}
          <small>{t.status}: {st ? `${st.status}${st.error ? ' — ' + st.error : ''} · ${st.tools.join(', ')}` : '-'}</small>
        </div>) })}
      <div className="row">
        <button onClick={() => setServers([...s.mcpServers, { id: uid(), name: 'filesystem', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'], enabled: false }])}><Plus size={14} />{t.addMcp}</button>
        <button onClick={() => api.syncTools(s.mcpServers).then(setStatus)}>{t.reconnect}</button>
      </div>
      <h3>{t.alwaysAllowed}</h3>
      {allow.length === 0 ? <p className="hint">{t.none}</p> : allow.map(n => <div key={n} className="row"><code>{n}</code><button onClick={() => api.revokeTool(n).then(setAllow)}>{t.revoke}</button></div>)}
      <h3>{t.plugins}</h3>
      <p className="hint">{t.pluginHelp}</p>
      <button onClick={() => api.openPluginDir()}>{t.openPluginDir}</button>
      {status.plugins.map((p: any) => <div key={p.name} className="card"><b>{p.name}</b> <small>{p.name === 'builtin' ? t.builtinTools : p.description}</small><div>{p.tools.join(', ')}</div></div>)}
    </div>
  )
}
