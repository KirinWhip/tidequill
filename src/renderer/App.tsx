import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, Conversation, Message, Persona, PromptItem, Settings, GalleryImage } from '../shared/types'
import { conversationToMarkdown, exportJSON, importJSON, importMarkdown, searchConversations, sortConversations, uid } from '../shared/storage'
import { streamChat } from '../shared/providers'
import { ProviderError } from '../shared/errors'
import { api, storage, bridgeFetch, setRequestTimeout } from './api'
import { dicts, resolveLang, I18n, type Dict } from './i18n'
import { Markdown } from './components/Markdown'
import { extractText, readAsDataURL } from './files'
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
  const shown = useMemo(() => searchConversations(sortConversations(convs), query), [convs, query])

  /** run the model on conversation `id` with given messages; handles tool-call loop */
  const runModel = async (id: string, history: Message[]) => {
    if (!settings) return
    const conv = convs.find(c => c.id === id) || cur!
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
        const ctx = msgs.slice(0, -1).slice(-Math.max(1, settings.contextLength))
        // make sure context doesn't start with a dangling tool message
        while (ctx.length && ctx[0].role === 'tool') ctx.shift()
        const res = await streamChat(provider, conv.systemPrompt, ctx, {
          model: conv.model, temperature: settings.temperature, maxTokens: settings.maxTokens, tools: tools.length ? tools : undefined, signal: ctrl.signal, fetchImpl: bridgeFetch,
          onDelta: d => { text += d; patchConv(id, c => ({ ...c, messages: c.messages.map(m => m.id === aid ? { ...m, content: text } : m) })) },
        })
        const final: Message = { ...asst, content: res.text, toolCalls: res.toolCalls.length ? res.toolCalls : undefined }
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
      const c0 = convs.find(c => c.id === id)
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
  return (
    <I18n.Provider value={t}>
    <div className="app">
      <aside className="sidebar">
        <div className="brand">💬 {t.brand}</div>
        <button className="primary block" onClick={() => newChat()}>＋ {t.newChat}</button>
        <input ref={searchRef} className="search" placeholder={t.search} value={query} onChange={e => setQuery(e.target.value)} />
        <div className="convlist">
          {shown.map(c => <ConvItem key={c.id} c={c} active={c.id === curId} t={t} onClick={() => setCurId(c.id)}
            onRename={title => patchConv(c.id, x => ({ ...x, title }))}
            onPin={() => patchConv(c.id, x => ({ ...x, pinned: !x.pinned }))}
            onDelete={() => { if (confirm(t.confirmDelete)) { updateConvs(l => l.filter(x => x.id !== c.id)); if (curId === c.id) setCurId('') } }} />)}
        </div>
        <nav className="sidenav">
          <button onClick={() => setModal('personas')}>🎭 {t.personas}</button>
          <button onClick={() => setModal('prompts')}>📚 {t.prompts}</button>
          <button onClick={() => setModal('images')}>🎨 {t.images}</button>
          <button onClick={() => setModal('tools')}>🧩 {t.tools}</button>
          <button onClick={doImport}>📥 {t.importData}</button>
          <button onClick={() => api.saveFile('chatbox-export.json', exportJSON(convs))}>📤 {t.exportJson}</button>
          <button onClick={() => setModal('settings')}>⚙️ {t.settings}</button>
        </nav>
      </aside>
      <main className="main">
        {cur ? <ChatView key={cur.id} conv={cur} settings={settings} t={t} dark={dark} busy={busyId === cur.id} prompts={prompts}
          onSend={send} onStop={() => abortRef.current?.abort()} onRegenerate={regenerate} onEditResend={editResend} onDeleteMsg={deleteMsg}
          onPatch={fn => patchConv(cur.id, fn)} onExport={() => api.saveFile(`${cur.title}.md`, conversationToMarkdown(cur, { model: t.exportedModel, attachment: t.attachment }))} />
          : <div className="empty"><div><h2>💬</h2><p>{t.empty}</p><button className="primary" onClick={() => newChat()}>{t.newChat}</button></div></div>}
      </main>
      {modal && <div className="overlay" onClick={() => setModal(null)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <button className="close" onClick={() => setModal(null)}>✕</button>
          {modal === 'settings' && <SettingsPanel s={settings} t={t} onChange={saveSettings} />}
          {modal === 'personas' && <PersonasPanel list={personas} t={t} onChange={l => { setPersonas(l); storage.savePersonas(l) }} onUse={p => newChat(p)} />}
          {modal === 'prompts' && <PromptsPanel list={prompts} t={t} onChange={l => { setPrompts(l); storage.savePrompts(l) }} />}
          {modal === 'images' && <ImagesPanel s={settings} t={t} gallery={gallery} onChange={g => { setGallery(g); storage.saveGallery(g) }} />}
          {modal === 'tools' && <ToolsPanel s={settings} t={t} onChange={saveSettings} />}
        </div>
      </div>}
    </div>
    </I18n.Provider>
  )
}

function ConvItem({ c, active, t, onClick, onRename, onPin, onDelete }: { c: Conversation; active: boolean; t: Dict; onClick(): void; onRename(s: string): void; onPin(): void; onDelete(): void }) {
  const [editing, setEditing] = useState(false); const [v, setV] = useState(c.title)
  return (
    <div className={'conv' + (active ? ' active' : '')} onClick={onClick}>
      {editing ? <input autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={() => { onRename(v); setEditing(false) }} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        : <span className="title">{c.pinned ? '📌 ' : ''}{c.title}</span>}
      <span className="acts">
        <button title={t.rename} onClick={e => { e.stopPropagation(); setV(c.title); setEditing(true) }}>✎</button>
        <button title={c.pinned ? t.unpin : t.pin} onClick={e => { e.stopPropagation(); onPin() }}>📌</button>
        <button title={t.delete} onClick={e => { e.stopPropagation(); onDelete() }}>🗑</button>
      </span>
    </div>
  )
}

interface ChatProps {
  conv: Conversation; settings: Settings; t: Dict; dark: boolean; busy: boolean; prompts: PromptItem[]
  onSend(c: string, imgs: string[], att: Attachment[]): void; onStop(): void; onRegenerate(id: string): void; onEditResend(id: string, c: string): void
  onDeleteMsg(id: string): void; onPatch(fn: (c: Conversation) => Conversation): void; onExport(): void
}

function ChatView({ conv, settings, t, dark, busy, prompts, onSend, onStop, onRegenerate, onEditResend, onDeleteMsg, onPatch, onExport }: ChatProps) {
  const [input, setInput] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [atts, setAtts] = useState<Attachment[]>([])
  const [parsing, setParsing] = useState(false)
  const [showSys, setShowSys] = useState(false)
  const [showPrompts, setShowPrompts] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const provider = settings.providers.find(p => p.id === conv.providerId)

  useEffect(() => { const el = listRef.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight }, [conv.messages])
  useEffect(() => { listRef.current && (listRef.current.scrollTop = listRef.current.scrollHeight) }, [])

  const addFiles = async (files: FileList | File[]) => {
    setParsing(true)
    for (const f of Array.from(files)) {
      try {
        if (f.type.startsWith('image/')) { const d = await readAsDataURL(f); setImages(x => [...x, d]) }
        else { const text = await extractText(f); setAtts(x => [...x, { name: f.name, text: text.slice(0, 200000) }]) }
      } catch (e: any) { alert(`${t.err_parse_file}${f.name} — ${e.message}`) }
    }
    setParsing(false)
  }
  const submit = () => {
    if (busy || (!input.trim() && !images.length && !atts.length)) return
    onSend(input, images, atts); setInput(''); setImages([]); setAtts([])
  }
  const visible = conv.messages.filter(m => m.role !== 'tool')
  const toolResults = new Map(conv.messages.filter(m => m.role === 'tool').map(m => [m.toolCallId, m.content]))

  return (
    <div className="chat" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}>
      <header className="chathead">
        <span className="ctitle">{conv.title}</span>
        <select title={t.provider} value={conv.providerId} onChange={e => { const p = settings.providers.find(x => x.id === e.target.value)!; onPatch(c => ({ ...c, providerId: p.id, model: p.models[0] || c.model })) }}>
          {settings.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="model" list={'models-' + conv.id} value={conv.model} onChange={e => onPatch(c => ({ ...c, model: e.target.value }))} title={t.model} />
        <datalist id={'models-' + conv.id}>{provider?.models.map(m => <option key={m} value={m} />)}</datalist>
        <button onClick={() => setShowSys(!showSys)} title={t.systemPrompt}>🧠</button>
        <button onClick={onExport} title={t.exportMd}>{t.exportMdShort}</button>
      </header>
      {showSys && <div className="sysbox"><label>{t.systemPrompt}</label><textarea value={conv.systemPrompt} onChange={e => onPatch(c => ({ ...c, systemPrompt: e.target.value }))} rows={3} /></div>}
      <div className="messages" ref={listRef}>
        {visible.length === 0 && <div className="empty small">{t.empty}</div>}
        {visible.map((m, i) => <MessageItem key={m.id} m={m} t={t} dark={dark} streaming={busy && i === visible.length - 1 && m.role === 'assistant'} toolResults={toolResults}
          onRegenerate={() => onRegenerate(m.id)} onEditResend={c => onEditResend(m.id, c)} onDelete={() => onDeleteMsg(m.id)} disabled={busy} />)}
      </div>
      <div className="composer">
        {(images.length > 0 || atts.length > 0 || parsing) && <div className="pending">
          {images.map((d, i) => <span key={i} className="thumb"><img src={d} /><button title={t.removeItem} onClick={() => setImages(x => x.filter((_, j) => j !== i))}>✕</button></span>)}
          {atts.map((a, i) => <span key={i} className="chip">📄 {a.name} <button title={t.removeItem} onClick={() => setAtts(x => x.filter((_, j) => j !== i))}>✕</button></span>)}
          {parsing && <span className="chip">{t.parsing}</span>}
        </div>}
        {showPrompts && <div className="promptpop">{prompts.map(p => <div key={p.id} onClick={() => { setInput(x => x + p.content); setShowPrompts(false) }}><b>{p.title}</b> {p.content.slice(0, 40)}</div>)}</div>}
        <div className="inputrow">
          <button title={t.attach} onClick={() => fileRef.current?.click()}>📎</button>
          <button title={t.prompts} onClick={() => setShowPrompts(!showPrompts)}>📚</button>
          <input ref={fileRef} type="file" multiple hidden accept="image/*,.pdf,.docx,.txt,.md,.json,.csv,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.h,.go,.rs,.rb,.php,.html,.css,.sh,.yaml,.yml,.xml,.sql"
            onChange={e => { e.target.files && addFiles(e.target.files); e.target.value = '' }} />
          <textarea value={input} placeholder={settings.sendKey === 'Enter' ? t.placeholder : t.placeholderCtrl} rows={3}
            onChange={e => setInput(e.target.value)}
            onPaste={e => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); addFiles(fs) } }}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return
              if (settings.sendKey === 'Enter' ? (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) : (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); submit() }
            }} />
          {busy ? <button className="danger" onClick={onStop}>■ {t.stop}</button> : <button className="primary" onClick={submit}>➤ {t.send}</button>}
        </div>
      </div>
    </div>
  )
}

function MessageItem({ m, t, dark, streaming, toolResults, onRegenerate, onEditResend, onDelete, disabled }: { m: Message; t: Dict; dark: boolean; streaming: boolean; toolResults: Map<any, string>; onRegenerate(): void; onEditResend(c: string): void; onDelete(): void; disabled: boolean }) {
  const [editing, setEditing] = useState(false); const [v, setV] = useState(m.content); const [copied, setCopied] = useState(false)
  return (
    <div className={'msg ' + m.role}>
      <div className="avatar" title={m.role === 'user' ? t.user : t.assistant}>{m.role === 'user' ? '🧑' : '🤖'}</div>
      <div className="bubble">
        {m.role === 'assistant' && m.model && <div className="meta">{m.model}</div>}
        {m.images?.map((d, i) => <img key={i} className="msgimg" src={d} />)}
        {m.attachments?.map((a, i) => <div key={i} className="chip">📄 {a.name} · {a.text.length} {t.chars}</div>)}
        {editing ? <div className="editbox"><textarea value={v} onChange={e => setV(e.target.value)} rows={4} />
          <div><button className="primary" onClick={() => { setEditing(false); onEditResend(v) }}>{t.saveSend}</button><button onClick={() => setEditing(false)}>{t.cancel}</button></div></div>
          : m.role === 'user' ? <div className="usertext">{m.content}</div> : <Markdown text={m.content || (streaming ? '▍' : '')} dark={dark} />}
        {m.toolCalls?.map(c => <details key={c.id} className="toolcall"><summary>🔧 {t.toolCall}: {c.name}</summary><pre>{JSON.stringify(c.args, null, 2)}</pre>{toolResults.get(c.id) && <><div className="meta">{t.toolResult}</div><pre>{toolResults.get(c.id)}</pre></>}</details>)}
        {(m.error || m.errorCode) && <div className="error" data-error-code={m.errorCode || 'unknown'}>⚠ {(t as any)['err_' + (m.errorCode || 'unknown')] || t.err_unknown}{m.error && <details><summary>{t.details}</summary><code>{m.error}</code></details>}</div>}
        {!streaming && !editing && <div className="msgacts">
          <button onClick={() => { navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>{copied ? t.copied : t.copy}</button>
          {m.role === 'user' && <button disabled={disabled} onClick={() => { setV(m.content); setEditing(true) }}>{t.edit}</button>}
          {m.role === 'assistant' && <button disabled={disabled} onClick={onRegenerate}>{t.regenerate}</button>}
          <button disabled={disabled} onClick={onDelete}>{t.delete}</button>
        </div>}
      </div>
    </div>
  )
}
