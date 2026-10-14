import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ToolDef, Attachment, Conversation, Folder, Message, Persona, PromptItem, Settings, GalleryImage } from '../shared/types'
import { conversationToMarkdown, exportJSON, importJSON, importMarkdown, uid } from '../shared/storage'
import { streamChat, listModels, summarizeTitle } from '../shared/providers'
import type { RequestInfo } from '../shared/reqdebug'
import { ProviderError, withRetry } from '../shared/errors'
import { estimateMessages, estimateTokens } from '../shared/usage'
import { webSearch, searchContext, SearchError, type Citation } from '../shared/websearch'
import { branchAt, forkConversation, switchBranch } from '../shared/branches'
import { makeBackup, parseBackup, restoreSettings, makeSyncPayload, mergeSync, BACKUP_KEYS } from '../shared/sync'
import { api, storage, bridgeFetch, setRequestTimeout } from './api'
import { dicts, resolveLang, I18n, type Dict } from './i18n'
import { MdOptionsCtx } from './components/Markdown'
import { ChatView } from './components/ChatView'
import { Sidebar } from './components/Sidebar'
import { Onboarding } from './components/Onboarding'
import { PluginTrustModal, StorageNotices, type PendingPlugin } from './components/Security'
import { ConvSettings } from './components/ConvSettings'
import { webdavGet, webdavPut, webdavTest } from './webdav'
import { MessageSquare, MessageSquarePlus, X, CheckCircle2 } from 'lucide-react'
import { SettingsPanel, PersonasPanel, PromptsPanel, ImagesPanel, ToolsPanel, AboutPanel } from './components/Panels'

type Modal = null | 'settings' | 'personas' | 'prompts' | 'images' | 'tools' | 'about'
export interface AppActions {
  backup(includeKeys: boolean): Promise<void>; restore(): Promise<void>; sync(): Promise<string>
  detectOllama(): Promise<{ ok: boolean; count: number; url: string }>
  checkUpdate(): Promise<any>; systemStatus: any
  importData(): Promise<void> | void; exportAll(): any
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [convs, setConvs] = useState<Conversation[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [curId, setCurId] = useState<string>('')
  const [personas, setPersonas] = useState<Persona[]>([])
  const [prompts, setPrompts] = useState<PromptItem[]>([])
  const [gallery, setGallery] = useState<GalleryImage[]>([])
  const [modal, setModal] = useState<Modal>(null)
  const [convSettingsId, setConvSettingsId] = useState('')
  const [settingsNav, setSettingsNav] = useState<{ tab?: string; priceModel?: string }>({})
  useEffect(() => { if (modal !== 'settings') setSettingsNav({}) }, [modal])
  const [lastRequests, setLastRequests] = useState<Record<string, RequestInfo>>({})
  const [busyId, setBusyId] = useState<string>('')
  const [searchingId, setSearchingId] = useState<string>('')
  const [toast, setToast] = useState('')
  const [update, setUpdate] = useState<any>(null)
  const [systemStatus, setSystemStatus] = useState<any>({})
  const abortRef = useRef<AbortController | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [sysDark, setSysDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches)
  const [sysLocale, setSysLocale] = useState('zh-CN')
  const tombstones = useRef<Record<string, number>>({})
  const [pendingPlugins, setPendingPlugins] = useState<PendingPlugin[]>([])
  const [skippedPlugins, setSkippedPlugins] = useState<string[]>([])

  useEffect(() => {
    (async () => {
      const s = await storage.loadSettings()
      const loc = await api.locale(); setSysLocale(loc)
      const d = dicts[resolveLang(s.language, loc)]
      setRequestTimeout(s.requestTimeout)
      setSettings(s)
      const list = await storage.listConversations()
      setConvs(list); setCurId(list[0]?.id || '')
      setFolders(await storage.loadFolders()); tombstones.current = await storage.loadTombstones()
      setPersonas(await storage.loadPersonas(d)); setPrompts(await storage.loadPrompts(d)); setGallery(await storage.loadGallery())
      api.setProxy(s.proxy); api.setDevMode(!!s.devMode); api.syncTools(s.mcpServers).then((st: any) => setPendingPlugins(st?.pendingPlugins || []))
      if (s.autoCheckUpdate) api.checkUpdate().then((r: any) => r?.status === 'available' && setUpdate(r))
    })()
    const mq = matchMedia('(prefers-color-scheme: dark)'); const f = () => setSysDark(mq.matches)
    mq.addEventListener('change', f); return () => mq.removeEventListener('change', f)
  }, [])

  const lang = resolveLang(settings?.language, sysLocale)
  const t: Dict = dicts[lang]
  useEffect(() => { api.setLanguage(lang); document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en' }, [lang])
  const dark = settings ? (settings.theme === 'system' ? sysDark : settings.theme === 'dark') : false
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    api.setTitleBarTheme?.(dark)
    if (settings) document.documentElement.style.fontSize = settings.fontSize + 'px'
  }, [dark, settings?.fontSize])
  // system integration (global shortcut, tray, login item)
  useEffect(() => {
    if (!settings) return
    api.applySystem({ globalShortcut: settings.globalShortcut, tray: settings.tray, launchAtLogin: settings.launchAtLogin }).then(setSystemStatus)
  }, [settings?.globalShortcut, settings?.tray, settings?.launchAtLogin, !!settings, lang])
  const showToast = (s: string) => { setToast(s); setTimeout(() => setToast(x => x === s ? '' : x), 3500) }

  const saveSettings = (s: Settings) => {
    const prev = settings
    setSettings(s); storage.saveSettings(s); setRequestTimeout(s.requestTimeout)
    if (prev?.proxy !== s.proxy) api.setProxy(s.proxy)
    if (!!prev?.devMode !== !!s.devMode) api.setDevMode(!!s.devMode)
    if (JSON.stringify(prev?.mcpServers) !== JSON.stringify(s.mcpServers)) api.syncTools(s.mcpServers)
  }

  // persist conversations (debounced)
  const saveTimer = useRef<any>()
  const updateConvs = useCallback((fn: (l: Conversation[]) => Conversation[]) => {
    setConvs(prev => {
      const next = fn(prev)
      clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => storage.saveConversations(next.map(c => ({ ...c, messages: c.messages.map(({ status, ...m }) => m) }))), 400)
      return next
    })
  }, [])
  const patchConv = useCallback((id: string, fn: (c: Conversation) => Conversation) => updateConvs(l => l.map(c => c.id === id ? { ...fn(c), updatedAt: Date.now() } : c)), [updateConvs])
  const saveFolders = (f: Folder[]) => { setFolders(f); storage.saveFolders(f) }
  const deleteConvs = (ids: string[]) => {
    const now = Date.now()
    for (const id of ids) tombstones.current[id] = now
    storage.saveTombstones(tombstones.current)
    updateConvs(l => l.filter(x => !ids.includes(x.id)))
    if (ids.includes(curId)) setCurId('')
  }

  const newChat = useCallback((persona?: Persona) => {
    if (!settings) return
    const now = Date.now()
    const c: Conversation = { id: uid(), title: persona?.name || t.untitled, messages: [], providerId: settings.defaultProviderId, model: settings.defaultModel, systemPrompt: persona?.prompt || '', pinned: false, createdAt: now, updatedAt: now }
    updateConvs(l => [c, ...l]); setCurId(c.id); setModal(null)
  }, [settings, t, updateConvs])
  useEffect(() => { api.onCommand((cmd: string) => { if (cmd === 'newChat') newChat() }) }, [newChat])

  // shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newChat() }
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus() }
      if (mod && e.key === ',') { e.preventDefault(); setSettingsNav({}); setModal('settings') }
      if (e.key === 'Escape') { setModal(null); setConvSettingsId('') }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [newChat])

  const cur = convs.find(c => c.id === curId)
  const convsRef = useRef(convs); convsRef.current = convs

  /** web search for the last user message (when the toolbar toggle is on); never throws */
  const doSearch = async (id: string, history: Message[], signal: AbortSignal): Promise<{ citations?: Citation[]; searchQuery?: string; searchError?: string; userId?: string; extra?: string }> => {
    const ws = settings?.webSearch
    const lastUser = [...history].reverse().find(m => m.role === 'user')
    if (!ws?.enabled || !lastUser?.content.trim()) return {}
    const q = lastUser.content.trim()
    setSearchingId(id)
    try {
      const citations = await webSearch(ws, q, bridgeFetch, signal)
      if (!citations.length) return { searchQuery: q, searchError: t.searchNoResults }
      return { citations, searchQuery: q, userId: lastUser.id, extra: searchContext(citations, q, lang) }
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e
      const code = e instanceof SearchError ? e.code : e instanceof ProviderError ? (e.code === 'timeout' ? 'network' : 'network') : 'network'
      return { searchQuery: q, searchError: `${(t as any)['searchErr_' + code] || ''}${e?.message ? ' (' + String(e.message).slice(0, 200) + ')' : ''}` }
    } finally { setSearchingId('') }
  }
  /** messages sent to the model: last N, without un-chosen compare replies, search results appended to the asking message */
  const buildCtx = (msgs: Message[], contextLength: number, s: { userId?: string; extra?: string }) => {
    const ctx = msgs.filter(m => !m.compareGroup || m.compareChosen).slice(-Math.max(1, contextLength))
    while (ctx.length && ctx[0].role === 'tool') ctx.shift()
    return s.extra ? ctx.map(m => m.id === s.userId ? { ...m, content: m.content + s.extra } : m) : ctx
  }

  /** compare mode: the same question to the conversation model plus conv.compareModels, streamed in parallel */
  const runCompare = async (id: string, history: Message[]) => {
    if (!settings) return
    const conv = convsRef.current.find(c => c.id === id) || cur!
    const targets = [{ providerId: conv.providerId, model: conv.model }, ...(conv.compareModels || [])].slice(0, 4)
    const P = conv.params || {}
    const temperature = P.temperature ?? settings.temperature, topP = P.topP ?? settings.topP
    const maxTokens = P.maxTokens ?? settings.maxTokens, contextLength = P.contextLength ?? settings.contextLength
    const ctrl = new AbortController(); abortRef.current = ctrl; setBusyId(id)
    patchConv(id, c => ({ ...c, messages: history }))
    const setMsg = (aid: string, patch: Partial<Message>) => patchConv(id, c => ({ ...c, messages: c.messages.map(m => m.id === aid ? { ...m, ...patch } : m) }))
    try {
      const s = await doSearch(id, history, ctrl.signal)
      const ctx = buildCtx(history, contextLength, s)
      const gid = uid()
      const list: Message[] = targets.map((tg, i) => ({ id: uid(), role: 'assistant', content: '', model: tg.model, compareGroup: gid, compareChosen: i === 0, createdAt: Date.now(),
        citations: s.citations, searchQuery: s.searchQuery, searchError: s.searchError }))
      patchConv(id, c => ({ ...c, messages: [...history, ...list] }))
      await Promise.all(targets.map(async (tg, i) => {
        const aid = list[i].id
        const provider = settings.providers.find(p => p.id === tg.providerId)
        let text = '', reasoning = ''
        try {
          if (!provider) throw new ProviderError('bad_request', `provider ${tg.providerId} not found`)
          const res = await withRetry(() => {
            text = ''; reasoning = ''
            return streamChat(provider, conv.systemPrompt, ctx, { model: tg.model, temperature, topP, maxTokens, signal: ctrl.signal, fetchImpl: bridgeFetch, reasoning: !!conv.reasoning,
              onReasoning: r => { reasoning += r; setMsg(aid, { reasoning }) }, onDelta: d => { text += d; setMsg(aid, { content: text }) } })
          }, { retries: settings.retries, baseMs: settings.retryBaseMs, signal: ctrl.signal }, () => !text && !reasoning)
          setMsg(aid, { content: res.text, reasoning: res.reasoning || reasoning || undefined, usage: res.usage || { input: estimateMessages(ctx, conv.systemPrompt), output: estimateTokens(res.text + (res.reasoning || '')), estimated: true } })
        } catch (e: any) {
          if (e?.name === 'AbortError') return
          const pe = e instanceof ProviderError ? e : null
          setMsg(aid, { content: text, errorCode: pe?.code || 'unknown', error: pe ? (pe.status ? `HTTP ${pe.status} ` : '') + pe.detail : String(e?.message || e) })
        }
      }))
    } catch { /* aborted during search */ } finally { setBusyId(''); abortRef.current = null }
  }
  const chooseCompare = (msgId: string) => cur && patchConv(cur.id, c => {
    const g = c.messages.find(m => m.id === msgId)?.compareGroup
    return g ? { ...c, messages: c.messages.map(m => m.compareGroup === g ? { ...m, compareChosen: m.id === msgId } : m) } : c
  })

  /** run the model on conversation `id` with given history; handles retries, usage, reasoning and the tool-call loop */
  const runModel = async (id: string, history: Message[]) => {
    if (!settings) return
    const conv = convsRef.current.find(c => c.id === id) || cur!
    const provider = settings.providers.find(p => p.id === conv.providerId) || settings.providers[0]
    const P = conv.params || {}
    const temperature = P.temperature ?? settings.temperature, topP = P.topP ?? settings.topP
    const maxTokens = P.maxTokens ?? settings.maxTokens, contextLength = P.contextLength ?? settings.contextLength
    const ctrl = new AbortController(); abortRef.current = ctrl; setBusyId(id)
    let msgs = [...history]
    // builtin demo tools are only sent when explicitly enabled; plugin / MCP tools when tool calling is on
    const tools = settings.toolsEnabled ? (await api.listTools()).filter((x: ToolDef) => settings.builtinTools || !x.name.startsWith('builtin__')) : []
    const setMsg = (aid: string, patch: Partial<Message>) => patchConv(id, c => ({ ...c, messages: c.messages.map(m => m.id === aid ? { ...m, ...patch } : m) }))
    try {
      const s = await doSearch(id, history, ctrl.signal)
      for (let round = 0; round < 8; round++) {
        const aid = uid()
        const asst: Message = { id: aid, role: 'assistant', content: '', model: conv.model, createdAt: Date.now(), ...(round === 0 ? { citations: s.citations, searchQuery: s.searchQuery, searchError: s.searchError } : {}) }
        msgs = [...msgs, asst]
        patchConv(id, c => ({ ...c, messages: msgs, updatedAt: Date.now() }))
        let text = '', reasoning = ''
        const ctx = buildCtx(msgs.slice(0, -1), contextLength, s)
        const res = await withRetry(() => {
          text = ''; reasoning = ''
          return streamChat(provider, conv.systemPrompt, ctx, {
            model: conv.model, temperature, topP, maxTokens, tools: tools.length ? tools : undefined, signal: ctrl.signal, fetchImpl: bridgeFetch, reasoning: !!conv.reasoning,
            onRequest: r => setLastRequests(m => ({ ...m, [id]: { ...r, at: Date.now() } })),
            onReasoning: r => { reasoning += r; setMsg(aid, { reasoning, status: undefined }) },
            onDelta: d => { text += d; setMsg(aid, { content: text, status: undefined }) },
          })
        }, {
          retries: settings.retries, baseMs: settings.retryBaseMs, signal: ctrl.signal,
          onRetry: (n, delay) => setMsg(aid, { status: t.retrying.replace('{n}', String(n)).replace('{s}', (delay / 1000).toFixed(1)) }),
        }, () => !text && !reasoning)
        const usage = res.usage || { input: estimateMessages(ctx, conv.systemPrompt), output: estimateTokens(res.text + (res.reasoning || '')), estimated: true }
        const final: Message = { ...asst, content: res.text, reasoning: res.reasoning || reasoning || undefined, usage, toolCalls: res.toolCalls.length ? res.toolCalls : undefined }
        msgs = [...msgs.slice(0, -1), final]
        patchConv(id, c => ({ ...c, messages: msgs }))
        if (!res.toolCalls.length || ctrl.signal.aborted) break
        for (const call of res.toolCalls) {
          const result = await api.callTool(call.name, call.args)
          call.result = result
          msgs = [...msgs, { id: uid(), role: 'tool', toolCallId: call.id, content: result, createdAt: Date.now() }]
        }
        patchConv(id, c => ({ ...c, messages: msgs }))
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        const last = msgs[msgs.length - 1]
        const pe = e instanceof ProviderError ? e : null
        const partial = (e as any)?.partial?.text
        msgs = [...msgs.slice(0, -1), { ...last, status: undefined, content: partial || last.content, errorCode: pe?.code || 'unknown', error: pe ? (pe.status ? `HTTP ${pe.status} ` : '') + pe.detail : String(e?.message || e) }]
        patchConv(id, c => ({ ...c, messages: msgs }))
      }
    } finally {
      setBusyId(''); abortRef.current = null
      const c0 = convsRef.current.find(c => c.id === id)
      const isUntitled = (x: string) => x === t.untitled || x === dicts.zh.untitled || x === dicts.en.untitled
      if (c0 && !c0.titleManual && isUntitled(c0.title)) {
        const firstUser = msgs.find(m => m.role === 'user')
        if (firstUser) patchConv(id, c => c.titleManual ? c : ({ ...c, title: firstUser.content.slice(0, 30).replace(/\s+/g, ' ') || c.title }))
        const firstReply = msgs.find(m => m.role === 'assistant' && m.content && !m.error)
        if (settings.autoTitle && firstUser && firstReply && msgs.filter(m => m.role === 'user').length === 1) {
          const fallback = firstUser.content.slice(0, 30).replace(/\s+/g, ' ')
          summarizeTitle(provider, conv.model, firstUser.content, firstReply.content, t.titlePrompt, bridgeFetch).then(title => {
            if (title) patchConv(id, c => (c.titleManual || (c.title !== fallback && !isUntitled(c.title))) ? c : { ...c, title })
          }).catch(() => { /* keep the fallback title */ })
        }
      }
    }
  }

  const send = async (content: string, images: string[], attachments: Attachment[], quote?: string) => {
    if (!cur || busyId) return
    const m: Message = { id: uid(), role: 'user', content, quote, images: images.length ? images : undefined, attachments: attachments.length ? attachments : undefined, createdAt: Date.now() }
    await (cur.compareModels?.length ? runCompare : runModel)(cur.id, [...cur.messages, m])
  }
  /** regenerate: keep the old reply as a branch at that position */
  const regenerate = (msgId: string) => {
    if (!cur || busyId) return
    const idx = cur.messages.findIndex(m => m.id === msgId)
    let u = idx; while (u >= 0 && cur.messages[u].role !== 'user') u--
    if (u < 0) return
    const next = branchAt(cur, u + 1, [])
    patchConv(cur.id, () => next)
    convsRef.current = convsRef.current.map(c => c.id === cur.id ? next : c)
    ;(cur.compareModels?.length ? runCompare : runModel)(cur.id, next.messages)
  }
  /** edit & resend: the edited message starts a new branch */
  const editResend = (msgId: string, content: string) => {
    if (!cur || busyId) return
    const idx = cur.messages.findIndex(m => m.id === msgId)
    const edited: Message = { ...cur.messages[idx], id: uid(), content, createdAt: Date.now() }
    const next = branchAt(cur, idx, [edited])
    patchConv(cur.id, () => next)
    convsRef.current = convsRef.current.map(c => c.id === cur.id ? next : c)
    ;(cur.compareModels?.length ? runCompare : runModel)(cur.id, next.messages)
  }
  const deleteMsg = (msgId: string) => cur && patchConv(cur.id, c => {
    const i = c.messages.findIndex(m => m.id === msgId)
    return { ...c, messages: c.messages.filter(m => m.id !== msgId), branches: Object.fromEntries(Object.entries(c.branches || {}).filter(([k]) => +k < i)) }
  })
  const fork = (msgId: string) => {
    if (!cur) return
    const f = forkConversation(cur, msgId, uid(), `${cur.title} (${t.branchOf})`)
    updateConvs(l => [f, ...l]); setCurId(f.id)
  }

  const doImport = async () => {
    const f = await api.openFile(['json', 'md'])
    if (!f) return
    try {
      const list = f.name.endsWith('.md') ? [importMarkdown(f.content)] : importJSON(f.content)
      updateConvs(l => [...list.map(c => ({ ...c, providerId: c.providerId || settings!.defaultProviderId, model: c.model || settings!.defaultModel })), ...l.filter(x => !list.some(n => n.id === x.id))])
      setModal(null)
    } catch { alert(t.err_invalid_file) }
  }

  const actions: AppActions = {
    systemStatus,
    importData: doImport,
    exportAll: () => api.saveFile('tidequill-export.json', exportJSON(convs)),
    async backup(includeKeys) {
      const data: Record<string, any> = {}
      for (const k of BACKUP_KEYS) data[k] = await api.kvGet(k)
      data.conversations = convsRef.current
      if (await api.saveFile(`tidequill-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(makeBackup(data, includeKeys)))) showToast(t.backupDone)
    },
    async restore() {
      const f = await api.openFile(['json'])
      if (!f) return
      let b
      try { b = parseBackup(f.content) } catch { alert(t.err_invalid_file); return }
      if (!confirm(t.confirmRestore)) return
      clearTimeout(saveTimer.current) // drop pending debounced writes so they cannot overwrite restored data
      for (const k of BACKUP_KEYS) {
        if (b.data[k] === undefined) continue
        await api.kvSet(k, k === 'settings' ? restoreSettings(settings, b.data[k]) : b.data[k])
      }
      showToast(t.restoreDone)
      setTimeout(() => location.reload(), 600)
    },
    async sync() {
      const cfg = settings!.webdav
      const local = { conversations: convsRef.current, tombstones: tombstones.current, folders, personas, prompts }
      await webdavTest(cfg)
      const remote = await webdavGet(cfg)
      const merged = mergeSync(local, remote)
      await webdavPut(cfg, makeSyncPayload(merged))
      tombstones.current = merged.tombstones; storage.saveTombstones(merged.tombstones)
      updateConvs(() => merged.conversations); saveFolders(merged.folders)
      setPersonas(merged.personas); storage.savePersonas(merged.personas); setPrompts(merged.prompts); storage.savePrompts(merged.prompts)
      saveSettings({ ...settings!, webdav: { ...cfg, lastSync: Date.now() } })
      return `${merged.conversations.length}`
    },
    async detectOllama() {
      const p = settings!.providers.find(x => x.type === 'ollama')
      const url = p?.baseURL || 'http://localhost:11434'
      try {
        const models = await listModels(p || { id: 'ollama', name: 'Ollama', type: 'ollama', apiKey: '', baseURL: url, models: [] }, bridgeFetch)
        if (p) saveSettings({ ...settings!, providers: settings!.providers.map(x => x.id === p.id ? { ...x, models } : x) })
        return { ok: true, count: models.length, url }
      } catch { return { ok: false, count: 0, url } }
    },
    async checkUpdate() { const r = await api.checkUpdate(); if (r?.status === 'available') setUpdate(r); return r },
  }

  if (!settings) return null
  const needsOnboarding = !settings.onboarded && !settings.providers.some(p => p.apiKey)
  const convForSettings = convs.find(c => c.id === convSettingsId)
  return (
    <I18n.Provider value={t}>
    <MdOptionsCtx.Provider value={{ lineNumbers: settings.codeLineNumbers, collapseLines: settings.codeCollapseLines }}>
    <div className="shell">
    <header className={'titlebar plat-' + (api.platform || 'win32')} data-testid="titlebar">
      <span className="brand"><img src="./logo.png" alt="" width={18} height={18} className="brand-logo" />{t.brand}</span>
      {cur && <span className="tb-title" title={cur.title}>{cur.title}</span>}
    </header>
    <div className="app">
      <Sidebar convs={convs} folders={folders} curId={curId} searchRef={searchRef} busyId={busyId}
        onSelect={setCurId} onNew={() => newChat()} onPatch={patchConv} onDelete={deleteConvs} onFolders={saveFolders}
        onOpenSettings={id => setConvSettingsId(id)} onModal={m => setModal(m as Modal)}
        onExportMd={c => api.saveFile(`${c.title}.md`, conversationToMarkdown(c, { model: t.exportedModel, attachment: t.attachment }))}
        update={update} onUpdate={() => api.downloadUpdate().then(() => api.installUpdate())} />
      <main className="main">
        {cur ? <ChatView key={cur.id} conv={cur} convs={convs} settings={settings} dark={dark} busy={busyId === cur.id} searching={searchingId === cur.id} onChooseCompare={chooseCompare} prompts={prompts}
          onSend={send} onStop={() => abortRef.current?.abort()} onRegenerate={regenerate} onEditResend={editResend} onDeleteMsg={deleteMsg}
          onFork={fork} onSwitchBranch={(pos, idx) => patchConv(cur.id, c => switchBranch(c, pos, idx))} onOpenConv={setCurId}
          onPatch={fn => patchConv(cur.id, fn)} onSettings={saveSettings} onConvSettings={() => setConvSettingsId(cur.id)}
          onPriceSetup={model => { setSettingsNav({ tab: 'usageSettings', priceModel: model }); setModal('settings') }}
          onExport={kind => kind === 'md' ? api.saveFile(`${cur.title}.md`, conversationToMarkdown(cur, { model: t.exportedModel, attachment: t.attachment }))
            : kind === 'json' ? api.saveFile(`${cur.title}.json`, exportJSON([cur])) : api.exportPdf(`${cur.title}.pdf`)} />
          : <div className="empty"><div><MessageSquare size={40} /><p>{t.empty}</p><button className="btn primary" onClick={() => newChat()}><MessageSquarePlus size={16} />{t.newChat}</button></div></div>}
      </main>
      {modal && <div className="overlay" onClick={() => setModal(null)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <button className="icon-btn close" title={t.close} aria-label={t.close} onClick={() => setModal(null)}><X size={18} /></button>
          {modal === 'settings' && <SettingsPanel key={settingsNav.tab || 'default'} s={settings} t={t} onChange={saveSettings} actions={actions} initialTab={settingsNav.tab} priceModel={settingsNav.priceModel} />}
          {modal === 'personas' && <PersonasPanel list={personas} t={t} onChange={l => { setPersonas(l); storage.savePersonas(l) }} onUse={p => newChat(p)} />}
          {modal === 'prompts' && <PromptsPanel list={prompts} t={t} onChange={l => { setPrompts(l); storage.savePrompts(l) }} />}
          {modal === 'images' && <ImagesPanel s={settings} t={t} gallery={gallery} onChange={g => { setGallery(g); storage.saveGallery(g) }} />}
          {modal === 'about' && <AboutPanel t={t} onCheckUpdate={actions.checkUpdate} />}
          {modal === 'tools' && <ToolsPanel s={settings} t={t} onChange={saveSettings} />}
        </div>
      </div>}
      {convForSettings && <ConvSettings conv={convForSettings} settings={settings} lastRequest={lastRequests[convForSettings.id]} folders={folders} onPatch={fn => patchConv(convForSettings.id, fn)} onClose={() => setConvSettingsId('')} />}
      {needsOnboarding && <Onboarding settings={settings} onDone={s => saveSettings({ ...s, onboarded: true })} />}
      {modal !== 'tools' && pendingPlugins.filter(p => !skippedPlugins.includes(p.path)).slice(0, 1).map(p => <PluginTrustModal key={p.path} p={p} t={t} onDone={() => { setSkippedPlugins(l => [...l, p.path]); api.toolStatus().then((st: any) => setPendingPlugins(st?.pendingPlugins || [])) }} />)}
      <StorageNotices t={t} />
      {toast && <div className="toast" role="status"><CheckCircle2 size={14} />{toast}</div>}
    </div>
    </div>
    </MdOptionsCtx.Provider>
    </I18n.Provider>
  )
}
