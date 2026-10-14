import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, Conversation, Message, Persona, PromptItem, Settings, GalleryImage } from '../shared/types'
import { conversationToMarkdown, exportJSON, importJSON, importMarkdown, searchConversations, sortConversations, uid } from '../shared/storage'
import { streamChat } from '../shared/providers'
import { ProviderError } from '../shared/errors'
import { api, storage, bridgeFetch, setRequestTimeout } from './api'
import { dicts, resolveLang, I18n, type Dict } from './i18n'
import { MdOptionsCtx } from './components/Markdown'
import { ChatView } from './components/ChatView'
import { MessageSquarePlus, Search, Settings as SettingsIcon, Users, BookOpen, Image as ImageIcon, Puzzle, FileInput, FileOutput, Pin, PinOff, Pencil, Trash2, X, MessageSquare } from 'lucide-react'
import { SettingsPanel, PersonasPanel, PromptsPanel, ImagesPanel, ToolsPanel } from './components/Panels'

type Modal = null | 'settings' | 'personas' | 'prompts' | 'images' | 'tools'

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [convs, setConvs] = useState<Conversation[]>([])
  const [curId, setCurId] = useState<string>('')
  const [personas, setPersonas] = useState<Persona[]>([])
  const [prompts, setPrompts] = useState<PromptItem[]>([])
  const [gallery, setGallery] = useState<GalleryImage[]>([])
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [busyId, setBusyId] = useState<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [sysDark, setSysDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches)
  const [sysLocale, setSysLocale] = useState('zh-CN')

  useEffect(() => {
    (async () => {
      const s = await storage.loadSettings()
      const loc = await api.locale(); setSysLocale(loc)
      const d = dicts[resolveLang(s.language, loc)]
      setRequestTimeout(s.requestTimeout)
      setSettings(s)
      const list = await storage.listConversations()
      setConvs(list); setCurId(list[0]?.id || '')
      setPersonas(await storage.loadPersonas(d)); setPrompts(await storage.loadPrompts(d)); setGallery(await storage.loadGallery())
      api.setProxy(s.proxy); api.syncTools(s.mcpServers)
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
    if (settings) document.documentElement.style.fontSize = settings.fontSize + 'px'
  }, [dark, settings?.fontSize])

  const saveSettings = (s: Settings) => {
    const prev = settings
    setSettings(s); storage.saveSettings(s); setRequestTimeout(s.requestTimeout)
    if (prev?.proxy !== s.proxy) api.setProxy(s.proxy)
    if (JSON.stringify(prev?.mcpServers) !== JSON.stringify(s.mcpServers)) api.syncTools(s.mcpServers)
  }

  // persist conversations (debounced)
  const saveTimer = useRef<any>()
  const updateConvs = useCallback((fn: (l: Conversation[]) => Conversation[]) => {
    setConvs(prev => {
      const next = fn(prev)
      clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => storage.saveConversations(next), 400)
      return next
    })
  }, [])
  const patchConv = useCallback((id: string, fn: (c: Conversation) => Conversation) => updateConvs(l => l.map(c => c.id === id ? fn(c) : c)), [updateConvs])

  const newChat = useCallback((persona?: Persona) => {
    if (!settings) return
    const now = Date.now()
    const c: Conversation = { id: uid(), title: persona?.name || t.untitled, messages: [], providerId: settings.defaultProviderId, model: settings.defaultModel, systemPrompt: persona?.prompt || '', pinned: false, createdAt: now, updatedAt: now }
    updateConvs(l => [c, ...l]); setCurId(c.id); setModal(null)
  }, [settings, t, updateConvs])

  // shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newChat() }
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus() }
      if (mod && e.key === ',') { e.preventDefault(); setModal('settings') }
      if (e.key === 'Escape') setModal(null)
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [newChat])

  const cur = convs.find(c => c.id === curId)
  const convsRef = useRef(convs); convsRef.current = convs
  const shown = useMemo(() => searchConversations(sortConversations(convs), query), [convs, query])

  /** run the model on conversation `id` with given messages; handles tool-call loop */
  const runModel = async (id: string, history: Message[]) => {
    if (!settings) return
    const conv = convsRef.current.find(c => c.id === id) || cur!
    const provider = settings.providers.find(p => p.id === conv.providerId) || settings.providers[0]
    const ctrl = new AbortController(); abortRef.current = ctrl; setBusyId(id)
    let msgs = [...history]
    const tools = settings.toolsEnabled ? await api.listTools() : []
    try {
      for (let round = 0; round < 8; round++) {
        const aid = uid()
        const asst: Message = { id: aid, role: 'assistant', content: '', model: conv.model, createdAt: Date.now() }
        msgs = [...msgs, asst]
        patchConv(id, c => ({ ...c, messages: msgs, updatedAt: Date.now() }))
        let text = ''
        let reasoning = ''
        const ctx = msgs.slice(0, -1).slice(-Math.max(1, settings.contextLength))
        // make sure context doesn't start with a dangling tool message
        while (ctx.length && ctx[0].role === 'tool') ctx.shift()
        const res = await streamChat(provider, conv.systemPrompt, ctx, {
          model: conv.model, temperature: settings.temperature, maxTokens: settings.maxTokens, tools: tools.length ? tools : undefined, signal: ctrl.signal, fetchImpl: bridgeFetch, reasoning: !!conv.reasoning,
          onReasoning: r => { reasoning += r; patchConv(id, c => ({ ...c, messages: c.messages.map(m => m.id === aid ? { ...m, reasoning } : m) })) },
          onDelta: d => { text += d; patchConv(id, c => ({ ...c, messages: c.messages.map(m => m.id === aid ? { ...m, content: text } : m) })) },
        })
        const final: Message = { ...asst, content: res.text, reasoning: res.reasoning || reasoning || undefined, toolCalls: res.toolCalls.length ? res.toolCalls : undefined }
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
        msgs = [...msgs.slice(0, -1), { ...last, content: partial || last.content, errorCode: pe?.code || 'unknown', error: pe ? (pe.status ? `HTTP ${pe.status} ` : '') + pe.detail : String(e?.message || e) }]
        patchConv(id, c => ({ ...c, messages: msgs }))
      }
    } finally {
      setBusyId(''); abortRef.current = null
      // auto title
      const c0 = convsRef.current.find(c => c.id === id)
      if (c0 && (c0.title === t.untitled || c0.title === dicts.zh.untitled || c0.title === dicts.en.untitled)) {
        const firstUser = msgs.find(m => m.role === 'user')
        if (firstUser) patchConv(id, c => ({ ...c, title: firstUser.content.slice(0, 30).replace(/\s+/g, ' ') || c.title }))
      }
    }
  }

  const send = async (content: string, images: string[], attachments: Attachment[]) => {
    if (!cur || busyId) return
    const m: Message = { id: uid(), role: 'user', content, images: images.length ? images : undefined, attachments: attachments.length ? attachments : undefined, createdAt: Date.now() }
    await runModel(cur.id, [...cur.messages, m])
  }
  const regenerate = (msgId: string) => {
    if (!cur || busyId) return
    const idx = cur.messages.findIndex(m => m.id === msgId)
    let u = idx; while (u >= 0 && cur.messages[u].role !== 'user') u--
    if (u < 0) return
    runModel(cur.id, cur.messages.slice(0, u + 1))
  }
  const editResend = (msgId: string, content: string) => {
    if (!cur || busyId) return
    const idx = cur.messages.findIndex(m => m.id === msgId)
    runModel(cur.id, [...cur.messages.slice(0, idx), { ...cur.messages[idx], content }])
  }
  const deleteMsg = (msgId: string) => cur && patchConv(cur.id, c => ({ ...c, messages: c.messages.filter(m => m.id !== msgId) }))

  const doImport = async () => {
    const f = await api.openFile(['json', 'md'])
    if (!f) return
    try {
      const list = f.name.endsWith('.md') ? [importMarkdown(f.content)] : importJSON(f.content)
      updateConvs(l => [...list.map(c => ({ ...c, providerId: c.providerId || settings!.defaultProviderId, model: c.model || settings!.defaultModel })), ...l.filter(x => !list.some(n => n.id === x.id))])
    } catch { alert(t.err_invalid_file) }
  }

  if (!settings) return null
  const navItems: [Modal | 'import' | 'export', any, string][] = [
    ['personas', Users, t.personas], ['prompts', BookOpen, t.prompts], ['images', ImageIcon, t.images], ['tools', Puzzle, t.tools],
    ['import', FileInput, t.importData], ['export', FileOutput, t.exportJson], ['settings', SettingsIcon, t.settings],
  ]
  return (
    <I18n.Provider value={t}>
    <MdOptionsCtx.Provider value={{ lineNumbers: settings.codeLineNumbers, collapseLines: settings.codeCollapseLines }}>
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><MessageSquare size={20} className="brand-icon" />{t.brand}</div>
        <button className="btn primary block" onClick={() => newChat()}><MessageSquarePlus size={16} />{t.newChat}</button>
        <div className="searchbox"><Search size={14} /><input ref={searchRef} placeholder={t.search} aria-label={t.search} value={query} onChange={e => setQuery(e.target.value)} /></div>
        <div className="convlist">
          {shown.map(c => <ConvItem key={c.id} c={c} active={c.id === curId} t={t} onClick={() => setCurId(c.id)}
            onRename={title => patchConv(c.id, x => ({ ...x, title }))}
            onPin={() => patchConv(c.id, x => ({ ...x, pinned: !x.pinned }))}
            onDelete={() => { if (confirm(t.confirmDelete)) { updateConvs(l => l.filter(x => x.id !== c.id)); if (curId === c.id) setCurId('') } }} />)}
        </div>
        <nav className="sidenav">
          {navItems.map(([k, Icon, label]) => <button key={k} onClick={() => k === 'import' ? doImport() : k === 'export' ? api.saveFile('chatbox-export.json', exportJSON(convs)) : setModal(k as Modal)}>
            <Icon size={16} />{label}
          </button>)}
        </nav>
      </aside>
      <main className="main">
        {cur ? <ChatView key={cur.id} conv={cur} settings={settings} dark={dark} busy={busyId === cur.id} prompts={prompts}
          onSend={send} onStop={() => abortRef.current?.abort()} onRegenerate={regenerate} onEditResend={editResend} onDeleteMsg={deleteMsg}
          onPatch={fn => patchConv(cur.id, fn)} onSettings={saveSettings} onExport={() => api.saveFile(`${cur.title}.md`, conversationToMarkdown(cur, { model: t.exportedModel, attachment: t.attachment }))} />
          : <div className="empty"><div><MessageSquare size={40} /><p>{t.empty}</p><button className="btn primary" onClick={() => newChat()}><MessageSquarePlus size={16} />{t.newChat}</button></div></div>}
      </main>
      {modal && <div className="overlay" onClick={() => setModal(null)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <button className="icon-btn close" title={t.close} aria-label={t.close} onClick={() => setModal(null)}><X size={18} /></button>
          {modal === 'settings' && <SettingsPanel s={settings} t={t} onChange={saveSettings} />}
          {modal === 'personas' && <PersonasPanel list={personas} t={t} onChange={l => { setPersonas(l); storage.savePersonas(l) }} onUse={p => newChat(p)} />}
          {modal === 'prompts' && <PromptsPanel list={prompts} t={t} onChange={l => { setPrompts(l); storage.savePrompts(l) }} />}
          {modal === 'images' && <ImagesPanel s={settings} t={t} gallery={gallery} onChange={g => { setGallery(g); storage.saveGallery(g) }} />}
          {modal === 'tools' && <ToolsPanel s={settings} t={t} onChange={saveSettings} />}
        </div>
      </div>}
    </div>
    </MdOptionsCtx.Provider>
    </I18n.Provider>
  )
}

function ConvItem({ c, active, t, onClick, onRename, onPin, onDelete }: { c: Conversation; active: boolean; t: Dict; onClick(): void; onRename(s: string): void; onPin(): void; onDelete(): void }) {
  const [editing, setEditing] = useState(false); const [v, setV] = useState(c.title)
  return (
    <div className={'conv' + (active ? ' active' : '')} onClick={onClick}>
      {c.pinned ? <Pin size={13} className="pinmark" /> : <MessageSquare size={13} className="convicon" />}
      {editing ? <input autoFocus value={v} aria-label={t.rename} onChange={e => setV(e.target.value)} onBlur={() => { onRename(v); setEditing(false) }} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        : <span className="title">{c.title}</span>}
      <span className="acts">
        <button className="icon-btn sm" title={t.rename} aria-label={t.rename} onClick={e => { e.stopPropagation(); setV(c.title); setEditing(true) }}><Pencil size={13} /></button>
        <button className="icon-btn sm" title={c.pinned ? t.unpin : t.pin} aria-label={c.pinned ? t.unpin : t.pin} onClick={e => { e.stopPropagation(); onPin() }}>{c.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
        <button className="icon-btn sm" title={t.delete} aria-label={t.delete} onClick={e => { e.stopPropagation(); onDelete() }}><Trash2 size={13} /></button>
      </span>
    </div>
  )
}
