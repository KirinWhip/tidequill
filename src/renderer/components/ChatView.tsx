import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp, Square, Paperclip, BookOpen, SlidersHorizontal, Wrench, Brain, ScrollText, FileDown, X, FileText, Copy, Check, Pencil,
  RefreshCw, Trash2, Volume2, VolumeX, Bot, User, AlertTriangle, ChevronRight, ChevronLeft, GitBranch, Quote, Coins, Loader2, FileJson, Printer, Settings2,
} from 'lucide-react'
import { branchInfo } from '../../shared/branches'
import { conversationUsage, costOf, formatCost } from '../../shared/usage'
import type { Attachment, Conversation, Message, PromptItem, Settings } from '../../shared/types'
import { useT } from '../i18n'
import { Markdown, useCopy } from './Markdown'
import { ModelSelector } from './ModelSelector'
import { extractText, readAsDataURL } from '../files'

interface Props {
  conv: Conversation; convs: Conversation[]; settings: Settings; dark: boolean; busy: boolean; prompts: PromptItem[]
  onSend(c: string, imgs: string[], att: Attachment[], quote?: string): void; onStop(): void; onRegenerate(id: string): void; onEditResend(id: string, c: string): void
  onDeleteMsg(id: string): void; onPatch(fn: (c: Conversation) => Conversation): void; onExport(kind: 'md' | 'json' | 'pdf'): void; onSettings(s: Settings): void
  onFork(id: string): void; onSwitchBranch(pos: number, idx: number): void; onOpenConv(id: string): void; onConvSettings(): void
}

export function ChatView({ conv, convs, settings, dark, busy, prompts, onSend, onStop, onRegenerate, onEditResend, onDeleteMsg, onPatch, onExport, onSettings, onFork, onSwitchBranch, onOpenConv, onConvSettings }: Props) {
  const t = useT()
  const [showSys, setShowSys] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [quote, setQuote] = useState('')
  useEffect(() => { if (!exportOpen) return; const h = () => setExportOpen(false); setTimeout(() => window.addEventListener('click', h), 0); return () => window.removeEventListener('click', h) }, [exportOpen])
  const total = conversationUsage(conv.messages, settings.prices)
  const parent = conv.forkOf ? convs.find(c => c.id === conv.forkOf!.id) : undefined
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = listRef.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight }, [conv.messages])
  useEffect(() => { listRef.current && (listRef.current.scrollTop = listRef.current.scrollHeight) }, [])
  const visible = conv.messages.filter(m => m.role !== 'tool')
  const toolResults = new Map(conv.messages.filter(m => m.role === 'tool').map(m => [m.toolCallId, m.content]))

  return (
    <div className="chat">
      <header className="chathead">
        <span className="ctitle">{conv.title}</span>
        <ModelSelector providers={settings.providers} providerId={conv.providerId} model={conv.model} onChange={(providerId, model) => onPatch(c => ({ ...c, providerId, model }))} />
        <button className={'toggle' + (conv.reasoning ? ' on' : '')} aria-pressed={!!conv.reasoning} title={t.reasoningTip} aria-label={t.reasoning}
          onClick={() => onPatch(c => ({ ...c, reasoning: !c.reasoning }))}><Brain size={15} /><span>{t.reasoning}</span></button>
        <button className={'icon-btn' + (showSys ? ' active' : '')} title={t.systemPrompt} aria-label={t.systemPrompt} onClick={() => setShowSys(!showSys)}><ScrollText size={17} /></button>
        <button className="icon-btn" title={t.convSettings} aria-label={t.convSettings} onClick={onConvSettings}><Settings2 size={17} /></button>
        <span className="exportwrap">
          <button className={'icon-btn' + (exportOpen ? ' active' : '')} title={t.exportAs} aria-label={t.exportAs} onClick={() => setExportOpen(!exportOpen)}><FileDown size={17} /></button>
          {exportOpen && <div className="ctxmenu dropdown" role="menu">
            <button role="menuitem" onClick={() => onExport('md')}><FileText size={14} />{t.exportMd}</button>
            <button role="menuitem" onClick={() => onExport('json')}><FileJson size={14} />{t.exportJsonConv}</button>
            <button role="menuitem" onClick={() => onExport('pdf')}><Printer size={14} />{t.exportPdf}</button>
          </div>}
        </span>
      </header>
      {(parent || (settings.showUsage && total.messages > 0)) && <div className="convbar">
        {parent && <button className="linkbtn" onClick={() => onOpenConv(parent.id)}><GitBranch size={13} />{t.forkedFrom}{parent.title}</button>}
        <span className="spacer" />
        {settings.showUsage && total.messages > 0 && <span className="usage-total" data-testid="conv-usage"><Coins size={13} />{t.convTotal}: {t.tokens} {(total.input + total.output).toLocaleString()}
          {total.estimated ? ` (${t.estimated})` : ''} · {t.cost} {formatCost(total.cost)}</span>}
      </div>}
      {showSys && <div className="sysbox"><label htmlFor="sysprompt">{t.systemPrompt}</label><textarea id="sysprompt" value={conv.systemPrompt} onChange={e => onPatch(c => ({ ...c, systemPrompt: e.target.value }))} rows={3} /></div>}
      <div className="messages" ref={listRef}>
        {visible.length === 0 && <div className="empty small">{t.empty}</div>}
        {visible.map((m, i) => {
          const pos = conv.messages.indexOf(m)
          return <MessageItem key={m.id} m={m} dark={dark} streaming={busy && i === visible.length - 1 && m.role === 'assistant'} toolResults={toolResults}
            branch={branchInfo(conv, pos)} onBranch={idx => onSwitchBranch(pos, idx)} settings={settings}
            onRegenerate={() => onRegenerate(m.id)} onEditResend={c => onEditResend(m.id, c)} onDelete={() => onDeleteMsg(m.id)} disabled={busy}
            onFork={() => onFork(m.id)} onQuote={() => setQuote(m.content)} />
        })}
      </div>
      <Composer conv={conv} settings={settings} busy={busy} prompts={prompts} quote={quote} onClearQuote={() => setQuote('')} onSend={(a, b, c) => { onSend(a, b, c, quote || undefined); setQuote('') }} onStop={onStop} onSettings={onSettings} onPatch={onPatch} />
    </div>
  )
}

function Composer({ conv, settings, busy, prompts, quote, onClearQuote, onSend, onStop, onSettings, onPatch }: { conv: Conversation; settings: Settings; busy: boolean; prompts: PromptItem[]; quote: string; onClearQuote(): void; onSend: Props['onSend']; onStop(): void; onSettings(s: Settings): void; onPatch: Props['onPatch'] }) {
  const t = useT()
  const [input, setInput] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [atts, setAtts] = useState<Attachment[]>([])
  const [parsing, setParsing] = useState(false)
  const [pop, setPop] = useState<'' | 'prompts' | 'params'>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pop) return
    const h = (e: MouseEvent) => { if (!wrap.current?.querySelector('.composer-pop')?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.tb-pop-trigger')) setPop('') }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [pop])

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
  const set = (p: Partial<Settings>) => onSettings({ ...settings, ...p })
  const P = conv.params || {}
  const setP = (p: Partial<NonNullable<Conversation['params']>>) => onPatch(c => ({ ...c, params: { ...(c.params || {}), ...p } }))

  return (
    <div className="composer" ref={wrap} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}>
      <div className="composer-box">
        {quote && <div className="quotebar"><Quote size={13} /><span className="qtext">{t.quoting}{quote.slice(0, 120)}</span>
          <button className="icon-btn sm" title={t.removeItem} aria-label={t.removeItem} onClick={onClearQuote}><X size={12} /></button></div>}
        {(images.length > 0 || atts.length > 0 || parsing) && <div className="pending">
          {images.map((d, i) => <span key={i} className="thumb"><img src={d} alt={t.image} />
            <button className="remove" title={t.removeItem} aria-label={t.removeItem} onClick={() => setImages(x => x.filter((_, j) => j !== i))}><X size={12} /></button></span>)}
          {atts.map((a, i) => <span key={i} className="filechip" title={a.name}><FileText size={14} /><span className="fname">{a.name}</span>
            <button className="remove" title={t.removeItem} aria-label={t.removeItem} onClick={() => setAtts(x => x.filter((_, j) => j !== i))}><X size={12} /></button></span>)}
          {parsing && <span className="filechip">{t.parsing}</span>}
        </div>}
        <textarea value={input} placeholder={settings.sendKey === 'Enter' ? t.placeholder : t.placeholderCtrl} rows={3} aria-label={t.send}
          onChange={e => setInput(e.target.value)}
          onPaste={e => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); addFiles(fs) } }}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return
            if (settings.sendKey === 'Enter' ? (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) : (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); submit() }
          }} />
        <div className="toolbar">
          <button className="icon-btn" title={t.attach} aria-label={t.attach} onClick={() => fileRef.current?.click()}><Paperclip size={17} /></button>
          <button className={'icon-btn tb-pop-trigger' + (pop === 'prompts' ? ' active' : '')} title={t.prompts} aria-label={t.prompts} onClick={() => setPop(pop === 'prompts' ? '' : 'prompts')}><BookOpen size={17} /></button>
          <button className={'icon-btn tb-pop-trigger' + (pop === 'params' ? ' active' : '')} title={t.params} aria-label={t.params} onClick={() => setPop(pop === 'params' ? '' : 'params')}><SlidersHorizontal size={17} /></button>
          <button className={'toggle sm' + (settings.toolsEnabled ? ' on' : '')} aria-pressed={settings.toolsEnabled} title={t.toolsToggleTip} aria-label={t.toolsToggle}
            onClick={() => set({ toolsEnabled: !settings.toolsEnabled })}><Wrench size={14} /><span>{t.toolsToggle}</span></button>
          <input ref={fileRef} type="file" multiple hidden accept="image/*,.pdf,.docx,.txt,.md,.json,.csv,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.h,.go,.rs,.rb,.php,.html,.css,.sh,.yaml,.yml,.xml,.sql"
            onChange={e => { e.target.files && addFiles(e.target.files); e.target.value = '' }} />
          <span className="spacer" />
          {busy
            ? <button className="sendbtn stop" title={t.stop} aria-label={t.stop} onClick={onStop}><Square size={14} fill="currentColor" /><span>{t.stop}</span></button>
            : <button className="sendbtn" title={t.send} aria-label={t.send} disabled={!input.trim() && !images.length && !atts.length} onClick={submit}><ArrowUp size={16} /><span>{t.send}</span></button>}
        </div>
      </div>
      {pop === 'prompts' && <div className="popover composer-pop promptpop">
        {prompts.map(p => <div key={p.id} className="popitem" onClick={() => { setInput(x => x + p.content); setPop('') }}><b>{p.title}</b><span>{p.content.slice(0, 50)}</span></div>)}
      </div>}
      {pop === 'params' && <div className="popover composer-pop parampop">
        <div className="poptitle">{t.params} · {t.convSettings}</div>
        <label>{t.temperature}<span className="val">{P.temperature ?? settings.temperature}</span><input type="range" min={0} max={2} step={0.1} value={P.temperature ?? settings.temperature} onChange={e => setP({ temperature: +e.target.value })} /></label>
        <label>{t.topP}<span className="val">{P.topP ?? settings.topP}</span><input type="range" min={0} max={1} step={0.05} value={P.topP ?? settings.topP} onChange={e => setP({ topP: +e.target.value })} /></label>
        <label>{t.maxTokens}<input type="number" min={1} value={P.maxTokens ?? settings.maxTokens} onChange={e => setP({ maxTokens: +e.target.value })} /></label>
        <label>{t.contextLength}<span className="val">{P.contextLength ?? settings.contextLength}</span><input type="range" min={1} max={100} value={P.contextLength ?? settings.contextLength} onChange={e => setP({ contextLength: +e.target.value })} /></label>
        <button className="btn sm" onClick={() => onPatch(c => ({ ...c, params: undefined }))}>{t.resetToGlobal}</button>
      </div>}
    </div>
  )
}

let speaking: string | null = null

function MessageItem({ m, dark, streaming, toolResults, onRegenerate, onEditResend, onDelete, disabled, branch, onBranch, onFork, onQuote, settings }: {
  m: Message; dark: boolean; streaming: boolean; toolResults: Map<any, string>; onRegenerate(): void; onEditResend(c: string): void; onDelete(): void; disabled: boolean
  branch: { index: number; total: number } | null; onBranch(i: number): void; onFork(): void; onQuote(): void; settings: Settings
}) {
  const t = useT()
  const [editing, setEditing] = useState(false); const [v, setV] = useState(m.content)
  const [copied, copy] = useCopy()
  const [reading, setReading] = useState(false)
  const readAloud = () => {
    const synth = window.speechSynthesis
    if (!synth) return
    if (reading) { synth.cancel(); setReading(false); return }
    synth.cancel()
    const u = new SpeechSynthesisUtterance(m.content.replace(/```[\s\S]*?```/g, ''))
    u.lang = /[\u4e00-\u9fff]/.test(m.content) ? 'zh-CN' : 'en-US'
    u.onend = u.onerror = () => { if (speaking === m.id) speaking = null; setReading(false) }
    speaking = m.id; setReading(true); synth.speak(u)
  }
  const time = new Date(m.createdAt).toLocaleString(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
  return (
    <div className={'msg ' + m.role}>
      <div className={'avatar ' + m.role} title={m.role === 'user' ? t.user : t.assistant}>{m.role === 'user' ? <User size={16} /> : <Bot size={16} />}</div>
      <div className="msgbody">
        <div className="bubble">
          {m.quote && <blockquote className="msgquote"><Quote size={12} />{m.quote.slice(0, 300)}</blockquote>}
          {m.status && <div className="status-line" data-testid="retry-status"><Loader2 size={13} className="spin" />{m.status}</div>}
          {m.images?.map((d, i) => <img key={i} className="msgimg" src={d} alt={t.image} />)}
          {m.attachments?.map((a, i) => <div key={i} className="filechip"><FileText size={14} /><span className="fname">{a.name}</span><span className="meta">{a.text.length} {t.chars}</span></div>)}
          {m.reasoning && <details className="reasoning" open={streaming && !m.content}>
            <summary><ChevronRight size={14} className="chev" /><Brain size={14} />{streaming && !m.content ? t.reasoningRunning : t.reasoningContent}</summary>
            <div className="reasoning-body">{m.reasoning}</div>
          </details>}
          {editing ? <div className="editbox"><textarea value={v} onChange={e => setV(e.target.value)} rows={4} aria-label={t.edit} />
            <div className="row"><button className="btn primary" onClick={() => { setEditing(false); onEditResend(v) }}>{t.saveSend}</button><button className="btn" onClick={() => setEditing(false)}>{t.cancel}</button></div></div>
            : m.role === 'user' ? <div className="usertext">{m.content}</div> : <>{m.content && <Markdown text={m.content} dark={dark} />}{streaming && <span className="caret" aria-hidden />}</>}
          {m.toolCalls?.map(c => <details key={c.id} className="toolcall"><summary><Wrench size={13} />{t.toolCall}: {c.name}</summary><pre>{JSON.stringify(c.args, null, 2)}</pre>{toolResults.get(c.id) && <><div className="meta">{t.toolResult}</div><pre>{toolResults.get(c.id)}</pre></>}</details>)}
          {(m.error || m.errorCode) && <div className="error" data-error-code={m.errorCode || 'unknown'}><AlertTriangle size={14} />
            <span>{(t as any)['err_' + (m.errorCode || 'unknown')] || t.err_unknown}{m.error && <details><summary>{t.details}</summary><code>{m.error}</code></details>}</span></div>}
        </div>
        {!streaming && !editing && <div className="msgacts">
          {branch && <span className="branchnav" data-testid="branch-nav">
            <button className="icon-btn sm" title={t.prevBranch} aria-label={t.prevBranch} disabled={disabled || branch.index === 0} onClick={() => onBranch(branch.index - 1)}><ChevronLeft size={14} /></button>
            <span className="meta">{branch.index + 1}/{branch.total}</span>
            <button className="icon-btn sm" title={t.nextBranch} aria-label={t.nextBranch} disabled={disabled || branch.index === branch.total - 1} onClick={() => onBranch(branch.index + 1)}><ChevronRight size={14} /></button>
          </span>}
          <span className="meta">{time}{m.model ? ` · ${m.model}` : ''}</span>
          {settings.showUsage && m.usage && <span className="meta usage" data-testid="msg-usage" title={t.tokens}>
            <Coins size={12} />{t.inputTokens} {m.usage.input} · {t.outputTokens} {m.usage.output}{m.usage.estimated ? ` (${t.estimated})` : ''} · {formatCost(costOf(m.model || '', m.usage, settings.prices))}</span>}
          <button className="icon-btn sm" title={copied ? t.copied : t.copy} aria-label={t.copy} onClick={() => copy(m.content)}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
          {m.role === 'user' && <button className="icon-btn sm" title={t.edit} aria-label={t.edit} disabled={disabled} onClick={() => { setV(m.content); setEditing(true) }}><Pencil size={14} /></button>}
          {m.role === 'assistant' && <button className="icon-btn sm" title={t.regenerate} aria-label={t.regenerate} disabled={disabled} onClick={onRegenerate}><RefreshCw size={14} /></button>}
          {m.role === 'assistant' && <button className="icon-btn sm" title={reading ? t.stopReading : t.readAloud} aria-label={reading ? t.stopReading : t.readAloud} onClick={readAloud}>{reading ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>}
          <button className="icon-btn sm" title={t.quoteReply} aria-label={t.quoteReply} onClick={onQuote}><Quote size={14} /></button>
          <button className="icon-btn sm" title={t.forkConv} aria-label={t.forkConv} disabled={disabled} onClick={onFork}><GitBranch size={14} /></button>
          <button className="icon-btn sm" title={t.delete} aria-label={t.delete} disabled={disabled} onClick={onDelete}><Trash2 size={14} /></button>
        </div>}
      </div>
    </div>
  )
}
