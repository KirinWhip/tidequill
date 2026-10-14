import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp, Square, Paperclip, BookOpen, SlidersHorizontal, Wrench, Brain, ScrollText, FileDown, X, FileText, Copy, Check, Pencil,
  RefreshCw, Trash2, Volume2, VolumeX, Bot, User, AlertTriangle, ChevronRight, ChevronLeft, GitBranch, Quote, Coins, Loader2, FileJson, Printer, Settings2,
  Globe, Mic, Columns2, Search, ChevronUp, ChevronDown, FileSpreadsheet, Presentation, ScanText, CheckCircle2, Circle,
} from 'lucide-react'
import { findAll, step } from '../../shared/find'
import { fmtBytes } from '../../shared/office'
import { transcribe } from '../../shared/stt'
import { api, bridgeFetch } from '../api'
import { ocrImage } from '../ocr'
import { branchInfo } from '../../shared/branches'
import { contextUsage, conversationUsage, costOf, DEFAULT_CONTEXT_WINDOWS, findContextWindow, findPrice, formatCost } from '../../shared/usage'
import type { Attachment, Conversation, Message, PromptItem, Settings } from '../../shared/types'
import { useT } from '../i18n'
import { Markdown, useCopy } from './Markdown'
import { ModelSelector } from './ModelSelector'
import { extractText, readAsDataURL, kindOf, UNSUPPORTED } from '../files'

interface Props {
  conv: Conversation; convs: Conversation[]; settings: Settings; dark: boolean; busy: boolean; searching?: boolean; prompts: PromptItem[]
  onChooseCompare?(msgId: string): void
  onSend(c: string, imgs: string[], att: Attachment[], quote?: string): void; onStop(): void; onRegenerate(id: string): void; onEditResend(id: string, c: string): void
  onDeleteMsg(id: string): void; onPatch(fn: (c: Conversation) => Conversation): void; onExport(kind: 'md' | 'json' | 'pdf'): void; onSettings(s: Settings): void
  /** open Settings > usage price table for this model */
  onPriceSetup?(model: string): void
  onFork(id: string): void; onSwitchBranch(pos: number, idx: number): void; onOpenConv(id: string): void; onConvSettings(): void
}

export function ChatView({ conv, convs, settings, dark, busy, searching, onChooseCompare, prompts, onSend, onStop, onRegenerate, onEditResend, onDeleteMsg, onPatch, onExport, onSettings, onFork, onSwitchBranch, onOpenConv, onConvSettings, onPriceSetup }: Props) {
  const t = useT()
  const [showSys, setShowSys] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [quote, setQuote] = useState('')
  useEffect(() => { if (!exportOpen) return; const h = () => setExportOpen(false); setTimeout(() => window.addEventListener('click', h), 0); return () => window.removeEventListener('click', h) }, [exportOpen])
  const total = conversationUsage(conv.messages, settings.prices)
  // header shortcuts (also shown in tooltips and Settings > Shortcuts)
  const [findOpen, setFindOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(!!conv.compareModels?.length)
  const hk = useRef({ onPatch, onConvSettings, setShowSys, setExportOpen, setFindOpen }); hk.current = { onPatch, onConvSettings, setShowSys, setExportOpen, setFindOpen }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'd' && !e.shiftKey) { e.preventDefault(); hk.current.onPatch(c => ({ ...c, reasoning: !c.reasoning })) }
      else if (k === 's' && e.shiftKey) { e.preventDefault(); hk.current.onConvSettings() }
      else if (k === 'p' && e.shiftKey) { e.preventDefault(); hk.current.setShowSys(x => !x) }
      else if (k === 'e' && !e.shiftKey) { e.preventDefault(); hk.current.setExportOpen(x => !x) }
      else if (k === 'f' && !e.shiftKey) { e.preventDefault(); hk.current.setFindOpen(false); setTimeout(() => hk.current.setFindOpen(true), 0) }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])
  const noPrice = settings.showUsage && !!conv.model && !findPrice(conv.model, settings.prices)
  const parent = conv.forkOf ? convs.find(c => c.id === conv.forkOf!.id) : undefined
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = listRef.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight }, [conv.messages])
  useEffect(() => { listRef.current && (listRef.current.scrollTop = listRef.current.scrollHeight) }, [])
  const visible = conv.messages.filter(m => m.role !== 'tool')
  const toolResults = new Map(conv.messages.filter(m => m.role === 'tool').map(m => [m.toolCallId, m.content]))

  return (
    <div className={'chat rw-' + (settings.readingWidth || 'standard')}>
      <header className="chathead">
        <span className="ctitle">{conv.title}</span>
        <ModelSelector providers={settings.providers} providerId={conv.providerId} model={conv.model} onChange={(providerId, model) => onPatch(c => ({ ...c, providerId, model }))} />
        <button className={'toggle' + (conv.reasoning ? ' on' : '')} aria-pressed={!!conv.reasoning} title={`${t.reasoning} (${t.key_ctrl}+D)\n${t.reasoningTip}`} aria-label={t.reasoning}
          onClick={() => onPatch(c => ({ ...c, reasoning: !c.reasoning }))}><Brain size={15} /><span>{t.reasoning}</span></button>
        <button className={'icon-btn' + (showSys ? ' active' : '')} title={`${t.systemPrompt} (${t.key_ctrl}+Shift+P)`} aria-label={t.systemPrompt} onClick={() => setShowSys(!showSys)}><ScrollText size={17} /></button>
        <button className={'icon-btn' + (findOpen ? ' active' : '')} data-testid="find-btn" title={`${t.find} (${t.key_ctrl}+F)`} aria-label={t.find} onClick={() => setFindOpen(!findOpen)}><Search size={17} /></button>
        <button className={'icon-btn' + (compareOpen || conv.compareModels?.length ? ' active' : '')} data-testid="compare-btn" title={`${t.compare}\n${t.compareTip}`} aria-label={t.compare} onClick={() => setCompareOpen(!compareOpen)}><Columns2 size={17} /></button>
        <button className="icon-btn" title={`${t.convSettings} (${t.key_ctrl}+Shift+S)`} aria-label={t.convSettings} onClick={onConvSettings}><Settings2 size={17} /></button>
        <span className="exportwrap">
          <button className={'icon-btn' + (exportOpen ? ' active' : '')} title={`${t.exportAs} (${t.key_ctrl}+E)`} aria-label={t.exportAs} onClick={() => setExportOpen(!exportOpen)}><FileDown size={17} /></button>
          {exportOpen && <div className="ctxmenu dropdown" role="menu">
            <button role="menuitem" onClick={() => onExport('md')}><FileText size={14} />{t.exportMd}</button>
            <button role="menuitem" onClick={() => onExport('json')}><FileJson size={14} />{t.exportJsonConv}</button>
            <button role="menuitem" onClick={() => onExport('pdf')}><Printer size={14} />{t.exportPdf}</button>
          </div>}
        </span>
      </header>
      {(parent || noPrice || (settings.showUsage && total.messages > 0)) && <div className="convbar">
        {parent && <button className="linkbtn" onClick={() => onOpenConv(parent.id)}><GitBranch size={13} />{t.forkedFrom}{parent.title}</button>}
        <span className="spacer" />
        {settings.showUsage && total.messages > 0 && <span className="usage-total" data-testid="conv-usage"><Coins size={13} />{t.convTotal}: {t.tokens} {(total.input + total.output).toLocaleString()}
          {total.estimated ? ` (${t.estimated})` : ''}{noPrice ? '' : ` · ${t.cost} ${formatCost(total.cost)}`}</span>}
        {noPrice && <button className="linkbtn noprice" data-testid="no-price" title={t.noPriceTip.replace('{model}', conv.model)} onClick={() => onPriceSetup?.(conv.model)}><Coins size={13} />{t.noPrice}</button>}
      </div>}
      {findOpen && <FindBar listRef={listRef} deps={conv.messages} onClose={() => setFindOpen(false)} />}
      {(compareOpen || !!conv.compareModels?.length) && <CompareBar conv={conv} settings={settings} disabled={busy} onPatch={onPatch} onClose={() => { onPatch(c => ({ ...c, compareModels: undefined })); setCompareOpen(false) }} />}
      {showSys && <div className="sysbox"><label htmlFor="sysprompt">{t.systemPrompt}</label><textarea id="sysprompt" value={conv.systemPrompt} onChange={e => onPatch(c => ({ ...c, systemPrompt: e.target.value }))} rows={3} /></div>}
      <div className="messages" ref={listRef}>
        {visible.length === 0 && <div className="empty small">{t.empty}</div>}
        {groupCompare(visible).map(g => {
          const item = (m: Message) => {
            const i = visible.indexOf(m), pos = conv.messages.indexOf(m)
            const last = m.compareGroup ? m.compareGroup === visible[visible.length - 1]?.compareGroup : i === visible.length - 1
            return <MessageItem key={m.id} m={m} dark={dark} streaming={busy && !!last && m.role === 'assistant'} toolResults={toolResults}
              branch={m.compareGroup ? null : branchInfo(conv, pos)} onBranch={idx => onSwitchBranch(pos, idx)} settings={settings}
              onRegenerate={() => onRegenerate(m.id)} onEditResend={c => onEditResend(m.id, c)} onDelete={() => onDeleteMsg(m.id)} disabled={busy}
              onFork={() => onFork(m.id)} onQuote={() => setQuote(m.content)} onPriceSetup={onPriceSetup} onChoose={() => onChooseCompare?.(m.id)} />
          }
          return g[0].compareGroup
            ? <div key={g[0].compareGroup} className={'compare-grid n' + g.length} data-testid="compare-grid">{g.map(item)}</div>
            : item(g[0])
        })}
        {searching && <div className="status-line searching" data-testid="searching"><Loader2 size={13} className="spin" />{t.searching}</div>}
      </div>
      <Composer conv={conv} settings={settings} busy={busy} prompts={prompts} quote={quote} onClearQuote={() => setQuote('')} onSend={(a, b, c) => { onSend(a, b, c, quote || undefined); setQuote('') }} onStop={onStop} onSettings={onSettings} onPatch={onPatch} />
    </div>
  )
}

/** consecutive replies of one compare group are shown side by side */
function groupCompare(list: Message[]): Message[][] {
  const out: Message[][] = []
  for (const m of list) {
    const prev = out[out.length - 1]
    if (m.compareGroup && prev?.[0].compareGroup === m.compareGroup) prev.push(m)
    else out.push([m])
  }
  return out
}

/** Ctrl+F: highlights matches with the CSS Custom Highlight API (no DOM changes), Enter / Shift+Enter to step */
function FindBar({ listRef, deps, onClose }: { listRef: React.RefObject<HTMLDivElement>; deps: unknown; onClose(): void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [cur, setCur] = useState(0)
  const [ranges, setRanges] = useState<Range[]>([])
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => {
    const root = listRef.current
    const out: Range[] = []
    if (root && q) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => {
        const el = n.parentElement
        if (!el || el.closest('.msgacts, .codebar, button, .previewbar, .sources .host')) return NodeFilter.FILTER_REJECT
        const d = el.closest('details')
        if (d && !d.open && !el.closest('summary')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      } })
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        for (const i of findAll(n.nodeValue || '', q)) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + q.length); out.push(r) }
      }
    }
    setRanges(out); setCur(c => Math.min(c, Math.max(0, out.length - 1)))
  }, [q, deps])
  useEffect(() => {
    const H = (window as any).Highlight, reg = (CSS as any).highlights
    if (!H || !reg) return
    reg.set('tq-find', new H(...ranges.filter((_, i) => i !== cur)))
    reg.set('tq-find-cur', new H(...(ranges[cur] ? [ranges[cur]] : [])))
    const r = ranges[cur]
    if (r) (r.startContainer.parentElement as HTMLElement)?.scrollIntoView({ block: 'center' })
    return () => { reg.delete('tq-find'); reg.delete('tq-find-cur') }
  }, [ranges, cur])
  const go = (d: 1 | -1) => setCur(c => Math.max(0, step(c, ranges.length, d)))
  return (
    <div className="findbar" role="search" data-testid="findbar">
      <Search size={14} />
      <input ref={input} value={q} placeholder={t.findPh} aria-label={t.find} onChange={e => { setQ(e.target.value); setCur(0) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1) } else if (e.key === 'Escape') { e.stopPropagation(); onClose() } }} />
      <span className="meta" data-testid="find-count" aria-live="polite">{q ? (ranges.length ? `${cur + 1}/${ranges.length}` : t.findNone) : ''}</span>
      <button className="icon-btn sm" title={`${t.findPrev} (Shift+Enter)`} aria-label={t.findPrev} disabled={!ranges.length} onClick={() => go(-1)}><ChevronUp size={14} /></button>
      <button className="icon-btn sm" title={`${t.findNext} (Enter)`} aria-label={t.findNext} disabled={!ranges.length} onClick={() => go(1)}><ChevronDown size={14} /></button>
      <button className="icon-btn sm" title={`${t.findClose} (Esc)`} aria-label={t.findClose} onClick={onClose}><X size={14} /></button>
    </div>
  )
}

/** compare mode: the conversation model plus up to 3 more models answer every question */
function CompareBar({ conv, settings, disabled, onPatch, onClose }: { conv: Conversation; settings: Settings; disabled: boolean; onPatch: Props['onPatch']; onClose(): void }) {
  const t = useT()
  const list = conv.compareModels || []
  const pname = (id: string) => settings.providers.find(p => p.id === id)?.name || id
  return (
    <div className="comparebar" data-testid="compare-bar">
      <Columns2 size={14} /><span className="label">{t.compareCount.replace('{n}', String(list.length + 1))}</span>
      <span className="mchip primary" title={pname(conv.providerId)}>{conv.model}</span>
      {list.map((x, i) => <span key={i} className="mchip" data-model={x.model} title={pname(x.providerId)}>{x.model}
        <button className="x" disabled={disabled} title={`${t.compareRemove} ${x.model}`} aria-label={`${t.compareRemove} ${x.model}`} onClick={() => onPatch(c => ({ ...c, compareModels: (c.compareModels || []).filter((_, j) => j !== i) }))}><X size={11} /></button></span>)}
      {list.length < 3 ? <span className="compare-add" data-testid="compare-add" title={t.compareAdd}><ModelSelector providers={settings.providers} providerId={conv.providerId} model={'+ ' + t.compareAdd}
        onChange={(providerId, model) => onPatch(c => ({ ...c, compareModels: [...(c.compareModels || []), { providerId, model }].slice(0, 3) }))} /></span>
        : <span className="meta">{t.compareMax}</span>}
      <span className="meta hint">{t.compareHint}</span>
      <span className="spacer" />
      <button className="btn sm" onClick={onClose}>{t.compareOff}</button>
    </div>
  )
}

function Composer({ conv, settings, busy, prompts, quote, onClearQuote, onSend, onStop, onSettings, onPatch }: { conv: Conversation; settings: Settings; busy: boolean; prompts: PromptItem[]; quote: string; onClearQuote(): void; onSend: Props['onSend']; onStop(): void; onSettings(s: Settings): void; onPatch: Props['onPatch'] }) {
  const t = useT()
  const [input, setInput] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [atts, setAtts] = useState<Attachment[]>([])
  const [parsing, setParsing] = useState<boolean | string>(false)
  const [pop, setPop] = useState<'' | 'prompts' | 'params'>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pop) return
    const h = (e: MouseEvent) => { if (!wrap.current?.querySelector('.composer-pop')?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.tb-pop-trigger')) setPop('') }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [pop])

  const [notes, setNotes] = useState<string[]>([])
  const note = (s: string) => setNotes(x => [...x.filter(y => y !== s), s])
  const maxMB = settings.maxAttachmentMB || 20, maxChars = settings.maxAttachmentChars || 200000
  const addFiles = async (files: FileList | File[]) => {
    setParsing(true)
    for (const f of Array.from(files)) {
      try {
        if (f.size > maxMB * 1048576) { note(t.attTooLarge.replace('{name}', f.name).replace('{size}', fmtBytes(f.size)).replace('{limit}', `${maxMB} MB`)); continue }
        if (UNSUPPORTED.test(f.name)) { note(t.attUnsupported.replace('{name}', f.name)); continue }
        if (f.type.startsWith('image/')) {
          const d = await readAsDataURL(f); setImages(x => [...x, d])
          const ocr = settings.ocr
          if (ocr?.enabled && api.ocrStatus) {
            const st = await api.ocrStatus(ocr.langs)
            const missing = ocr.langs.filter(l => !st[l])
            if (missing.length) { note(t.ocrNeedData + missing.map(l => (t as any)['lang_' + l] || l).join(', ')); continue }
            setParsing(t.ocrRunning)
            try {
              const text = await ocrImage(f, ocr.langs)
              if (text) setAtts(x => [...x, { name: t.ocrResultName.replace('{name}', f.name), text: text.slice(0, maxChars), kind: 'ocr', size: f.size, truncated: text.length > maxChars }])
            } catch (e: any) { note(t.ocrFailed + String(e?.message || e)) }
          }
        } else {
          setParsing(true)
          const text = await extractText(f)
          setAtts(x => [...x, { name: f.name, text: text.slice(0, maxChars), kind: kindOf(f.name), size: f.size, truncated: text.length > maxChars }])
        }
      } catch (e: any) { note(`${t.err_parse_file}${f.name} — ${e.message}`) }
    }
    setParsing(false)
  }
  // ---- voice input (OpenAI-compatible /audio/transcriptions) ----
  const stt = settings.stt
  const sttProvider = settings.providers.find(p => p.id === stt?.providerId) || settings.providers.find(p => p.type === 'openai' && p.apiKey)
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; timer: any } | null>(null)
  const [recState, setRecState] = useState<'' | 'rec' | 'busy'>('')
  const [recSec, setRecSec] = useState(0)
  useEffect(() => () => { const r = rec.current; if (r) { clearInterval(r.timer); r.stream.getTracks().forEach(x => x.stop()) } }, [])
  const startRec = async () => {
    if (!stt?.enabled || !sttProvider) { note(t.voiceNotConfigured); return }
    let stream: MediaStream
    try {
      if (!(await api.armMic?.())) throw new Error('permission')
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e: any) { note(t.voiceDenied + String(e?.message || e?.name || e)); return }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m)) || ''
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    mr.onstop = async () => {
      stream.getTracks().forEach(x => x.stop())
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
      setRecState('busy')
      try {
        const text = await transcribe(sttProvider, stt, { data: new Uint8Array(await blob.arrayBuffer()), type: blob.type }, bridgeFetch)
        if (text) setInput(x => (x && !/\s$/.test(x) ? x + ' ' : x) + text)
      } catch (e: any) { note(t.voiceFailed + String(e?.message || e)) } finally { setRecState('') }
    }
    const t0 = Date.now(); setRecSec(0)
    rec.current = { mr, stream, chunks, timer: setInterval(() => setRecSec(Math.floor((Date.now() - t0) / 1000)), 250) }
    mr.start(250); setRecState('rec')
  }
  const stopRec = () => { const r = rec.current; if (!r) return; clearInterval(r.timer); rec.current = null; r.mr.stop() }
  const submit = () => {
    if (busy || (!input.trim() && !images.length && !atts.length)) return
    onSend(input, images, atts); setInput(''); setImages([]); setAtts([])
  }
  const set = (p: Partial<Settings>) => onSettings({ ...settings, ...p })
  const P = conv.params || {}
  const setP = (p: Partial<NonNullable<Conversation['params']>>) => onPatch(c => ({ ...c, params: { ...(c.params || {}), ...p } }))

  const ctxLen = P.contextLength ?? settings.contextLength
  const cu = contextUsage(conv.messages.filter(m => !m.compareGroup || m.compareChosen), conv.systemPrompt, ctxLen, [quote, input, ...atts.map(a => a.text)].join('\n'), findContextWindow(conv.model, settings.contextWindows || DEFAULT_CONTEXT_WINDOWS))
  const fmtK = (n: number) => n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  const ctxTip = (cu.window ? t.ctxTip.replace('{used}', cu.used.toLocaleString()).replace('{window}', cu.window.toLocaleString()).replace('{n}', String(ctxLen)) : t.ctxTipUnknown.replace('{used}', cu.used.toLocaleString()).replace('{model}', conv.model))
    + (cu.level === 'near' ? '\n' + t.ctxNear : cu.level === 'over' ? '\n' + t.ctxOver : '')

  return (
    <div className="composer" ref={wrap} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}>
      <div className={'ctxbar ' + cu.level} data-testid="ctx-usage" data-level={cu.level} title={ctxTip} role="meter" aria-label={t.ctxLabel}
        aria-valuemin={0} aria-valuemax={cu.window || 0} aria-valuenow={cu.used}>
        <span className="ctxlabel">{t.ctxLabel}</span>
        {cu.window ? <span className="ctxtrack"><span className="ctxfill" style={{ width: `${Math.min(100, cu.ratio * 100).toFixed(1)}%` }} /></span> : null}
        <span className="ctxnum">{fmtK(cu.used)}{cu.window ? ` / ${fmtK(cu.window)} (${Math.round(cu.ratio * 100)}%)` : ` / ${t.ctxUnknownWindow}`}</span>
        {cu.level === 'near' && <span className="ctxwarn" data-testid="ctx-warn">{t.ctxNearShort}</span>}
        {cu.level === 'over' && <span className="ctxwarn" data-testid="ctx-warn">{t.ctxOverShort}</span>}
      </div>
      <div className="composer-box">
        {quote && <div className="quotebar"><Quote size={13} /><span className="qtext">{t.quoting}{quote.slice(0, 120)}</span>
          <button className="icon-btn sm" title={t.removeItem} aria-label={t.removeItem} onClick={onClearQuote}><X size={12} /></button></div>}
        {(images.length > 0 || atts.length > 0 || parsing) && <div className="pending">
          {images.map((d, i) => <span key={i} className="thumb"><img src={d} alt={t.image} />
            <button className="remove" title={t.removeItem} aria-label={t.removeItem} onClick={() => setImages(x => x.filter((_, j) => j !== i))}><X size={12} /></button></span>)}
          {atts.map((a, i) => <span key={i} className="filechip" data-kind={a.kind} title={a.truncated ? `${a.name}\n${t.attTruncatedTip.replaceAll('{n}', String(maxChars))}` : a.name}><AttIcon kind={a.kind} /><span className="fname">{a.name}</span>
            <span className="meta">{a.size ? fmtBytes(a.size) + ' · ' : ''}{a.text.length} {t.chars}</span>{a.truncated && <span className="badge warn">{t.attTruncated}</span>}
            <button className="remove" title={t.removeItem} aria-label={t.removeItem} onClick={() => setAtts(x => x.filter((_, j) => j !== i))}><X size={12} /></button></span>)}
          {parsing && <span className="filechip"><Loader2 size={13} className="spin" />{typeof parsing === 'string' ? parsing : t.parsing}</span>}
        </div>}
        {notes.length > 0 && <div className="attwarn" role="alert" data-testid="att-warning">
          <AlertTriangle size={14} /><div>{notes.map((n, i) => <div key={i}>{n}</div>)}</div>
          <button className="icon-btn sm" title={t.dismiss} aria-label={t.dismiss} onClick={() => setNotes([])}><X size={12} /></button></div>}
        {recState && <div className="recbar" data-testid="rec-bar" data-state={recState}>{recState === 'rec'
          ? <><span className="recdot" aria-hidden /><span>{t.voiceRecording.replace('{s}', String(recSec))}</span><span className="meta">{sttProvider?.name} · {stt?.model}</span></>
          : <><Loader2 size={13} className="spin" /><span>{t.voiceTranscribing}</span></>}</div>}
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
          <button className={'toggle sm' + (settings.webSearch?.enabled ? ' on' : '')} data-testid="search-toggle" aria-pressed={!!settings.webSearch?.enabled} aria-label={t.webSearch}
            title={`${t.webSearch} · ${t[('sp_' + (settings.webSearch?.provider || 'tavily')) as 'sp_tavily']}\n${t.webSearchTip}`}
            onClick={() => set({ webSearch: { ...settings.webSearch!, enabled: !settings.webSearch?.enabled } })}><Globe size={14} /><span>{t.webSearch}</span></button>
          {stt?.enabled && (recState === 'rec'
            ? <button className="icon-btn recording" data-testid="mic-btn" data-state="rec" title={t.voiceStop} aria-label={t.voiceStop} onClick={stopRec}><Square size={13} fill="currentColor" /></button>
            : <button className="icon-btn" data-testid="mic-btn" data-state={recState || 'idle'} disabled={recState === 'busy'} title={`${t.voice} · ${t.voiceStart}`} aria-label={t.voiceStart} onClick={startRec}><Mic size={17} /></button>)}
          <input ref={fileRef} type="file" multiple hidden accept="image/*,.pdf,.docx,.xlsx,.pptx,.txt,.md,.json,.csv,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.h,.go,.rs,.rb,.php,.html,.css,.sh,.yaml,.yml,.xml,.sql"
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

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }

function AttIcon({ kind }: { kind?: string }) {
  return kind === 'xlsx' ? <FileSpreadsheet size={14} /> : kind === 'pptx' ? <Presentation size={14} /> : kind === 'ocr' ? <ScanText size={14} /> : <FileText size={14} />
}

let speaking: string | null = null

function MessageItem({ m, dark, streaming, toolResults, onRegenerate, onEditResend, onDelete, disabled, branch, onBranch, onFork, onQuote, settings, onPriceSetup, onChoose }: {
  m: Message; dark: boolean; streaming: boolean; toolResults: Map<any, string>; onRegenerate(): void; onEditResend(c: string): void; onDelete(): void; disabled: boolean
  branch: { index: number; total: number } | null; onBranch(i: number): void; onFork(): void; onQuote(): void; settings: Settings; onPriceSetup?(model: string): void; onChoose?(): void
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
    <div className={'msg ' + m.role + (m.compareGroup ? ' cmp' + (m.compareChosen ? ' chosen' : '') : '')} data-model={m.compareGroup ? m.model : undefined}>
      <div className={'avatar ' + m.role} title={m.role === 'user' ? t.user : t.assistant}>{m.role === 'user' ? <User size={16} /> : <Bot size={16} />}</div>
      <div className="msgbody">
        <div className="bubble">
          {m.quote && <blockquote className="msgquote"><Quote size={12} />{m.quote.slice(0, 300)}</blockquote>}
          {m.status && <div className="status-line" data-testid="retry-status"><Loader2 size={13} className="spin" />{m.status}</div>}
          {m.images?.map((d, i) => <img key={i} className="msgimg" src={d} alt={t.image} />)}
          {m.compareGroup && <div className="cmphead"><Bot size={13} /><b>{m.model}</b>{m.compareChosen && <span className="badge ok" title={t.compareChosenTip}>{t.compareChosen}</span>}</div>}
          {m.attachments?.map((a, i) => <div key={i} className="filechip" data-kind={a.kind}><AttIcon kind={a.kind} /><span className="fname">{a.name}</span><span className="meta">{a.text.length} {t.chars}</span>{a.truncated && <span className="badge warn">{t.attTruncated}</span>}</div>)}
          {m.searchError && <div className="searchnote" data-testid="search-error"><Globe size={13} /><span>{t.searchFailed}{m.searchError}</span></div>}
          {m.reasoning && <details className="reasoning" open={streaming && !m.content}>
            <summary><ChevronRight size={14} className="chev" /><Brain size={14} />{streaming && !m.content ? t.reasoningRunning : t.reasoningContent}</summary>
            <div className="reasoning-body">{m.reasoning}</div>
          </details>}
          {editing ? <div className="editbox"><textarea value={v} onChange={e => setV(e.target.value)} rows={4} aria-label={t.edit} />
            <div className="row"><button className="btn primary" onClick={() => { setEditing(false); onEditResend(v) }}>{t.saveSend}</button><button className="btn" onClick={() => setEditing(false)}>{t.cancel}</button></div></div>
            : m.role === 'user' ? <div className="usertext">{m.content}</div> : <>{m.content && <Markdown text={m.content} dark={dark} citations={m.citations} />}{streaming && <span className="caret" aria-hidden />}</>}
          {m.citations?.length ? <div className="sources" data-testid="sources">
            <div className="srchead"><Globe size={13} />{t.sources}{m.searchQuery && <span className="meta" title={m.searchQuery}> · {t.searchedFor}{m.searchQuery.slice(0, 60)}</span>}</div>
            <ol>{m.citations.map(c => <li key={c.n}><a href={c.url} target="_blank" rel="noreferrer noopener" title={c.url} data-src={c.n}>
              <span className="n">{c.n}</span><span className="st">{c.title}</span><span className="host">{hostOf(c.url)}</span></a></li>)}</ol>
          </div> : null}
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
          {m.compareGroup && !m.compareChosen && <button className="btn sm" data-testid="compare-choose" title={t.compareChosenTip} disabled={disabled} onClick={onChoose}><Circle size={12} />{t.compareChoose}</button>}
          {m.compareGroup && m.compareChosen && <span className="meta chosen" title={t.compareChosenTip}><CheckCircle2 size={12} />{t.compareChosen}</span>}
          {settings.showUsage && m.usage && <span className="meta usage" data-testid="msg-usage" title={t.tokens}>
            <Coins size={12} />{t.inputTokens} {m.usage.input} · {t.outputTokens} {m.usage.output}{m.usage.estimated ? ` (${t.estimated})` : ''} · {m.model && !findPrice(m.model, settings.prices)
              ? <button className="linkbtn noprice" data-testid="msg-no-price" title={t.noPriceTip.replace('{model}', m.model)} onClick={() => onPriceSetup?.(m.model!)}>— {t.noPrice}</button>
              : formatCost(costOf(m.model || '', m.usage, settings.prices))}</span>}
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
