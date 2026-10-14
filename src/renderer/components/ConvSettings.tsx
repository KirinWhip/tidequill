import { useState } from 'react'
import { X } from 'lucide-react'
import type { Conversation, ConvParams, Folder, Settings } from '../../shared/types'
import { describeRequest, type RequestInfo } from '../../shared/reqdebug'
import { useT } from '../i18n'

/** per-conversation settings: system prompt, sampling params, folder and tags */
export function ConvSettings({ conv, settings, folders, onPatch, onClose, lastRequest }: { conv: Conversation; settings: Settings; folders: Folder[]; lastRequest?: RequestInfo; onPatch(fn: (c: Conversation) => Conversation): void; onClose(): void }) {
  const t = useT()
  const [title, setTitle] = useState(conv.title)
  const [sys, setSys] = useState(conv.systemPrompt)
  const [p, setP] = useState<ConvParams>(conv.params || {})
  const [folderId, setFolderId] = useState(conv.folderId || '')
  const [showReq, setShowReq] = useState(false)
  const [tags, setTags] = useState((conv.tags || []).join(', '))
  const num = (k: keyof ConvParams, v: string) => setP(x => { const n = { ...x }; if (v === '') delete n[k]; else n[k] = +v; return n })
  const save = () => {
    const params = Object.keys(p).length ? p : undefined
    onPatch(c => ({ ...c, title: title.trim() || c.title, titleManual: title.trim() && title.trim() !== c.title ? true : c.titleManual, systemPrompt: sys, params, folderId: folderId || undefined, tags: [...new Set(tags.split(/[,\uff0c]/).map(x => x.trim()).filter(Boolean))] }))
    onClose()
  }
  const field = (k: keyof ConvParams, label: string, step: number, min: number, max?: number) =>
    <label>{label}<input type="number" data-param={k} step={step} min={min} max={max} value={p[k] ?? ''} placeholder={`${t.useGlobal}: ${(settings as any)[k]}`} onChange={e => num(k, e.target.value)} /></label>
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal narrow" role="dialog" aria-label={t.convSettings} onClick={e => e.stopPropagation()}>
        <button className="icon-btn close" title={t.close} aria-label={t.close} onClick={onClose}><X size={18} /></button>
        <div className="panel">
          <h2>{t.convSettings}</h2>
          <div className="form">
            <label>{t.name}<input value={title} onChange={e => setTitle(e.target.value)} /></label>
            <label>{t.systemPrompt}<textarea rows={4} data-testid="conv-system" value={sys} onChange={e => setSys(e.target.value)} /></label>
            <div className="grid2">
              {field('temperature', t.temperature, 0.1, 0, 2)}
              {field('topP', t.topP, 0.05, 0, 1)}
              {field('maxTokens', t.maxTokens, 1, 1)}
              {field('contextLength', t.contextLength, 1, 1, 100)}
            </div>
            <label>{t.folder}<select value={folderId} onChange={e => setFolderId(e.target.value)}><option value="">{t.noFolder}</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            <label>{t.tags}<input value={tags} placeholder={t.tagsHint} data-testid="conv-tags" onChange={e => setTags(e.target.value)} /></label>
            <details className="reqdebug" open={showReq} onToggle={e => setShowReq((e.target as HTMLDetailsElement).open)}>
              <summary data-testid="req-debug-toggle">{t.viewRequest}</summary>
              {!lastRequest ? <div className="meta">{t.noRequestYet}</div> : (() => {
                const d = describeRequest(lastRequest.body)
                return <div data-testid="req-debug">
                  <table className="pricetable"><tbody>
                    <tr><td>{t.reqUrl}</td><td><code>{lastRequest.url}</code></td></tr>
                    <tr><td>{t.reqSystem}</td><td data-testid="req-system">{d.systemChars} {t.reqChars} ≈ {d.est.system} tokens</td></tr>
                    <tr><td>{t.reqTools}</td><td data-testid="req-tools">{d.toolCount} · {d.toolsBytes} B ≈ {d.est.tools} tokens</td></tr>
                    <tr><td>{t.reqMessages}</td><td>{d.messagesBytes} B ≈ {d.est.messages} tokens</td></tr>
                    <tr><td>{t.reqTotal}</td><td>{d.totalBytes} B ≈ {d.est.total} tokens</td></tr>
                  </tbody></table>
                  <div className="meta">{t.reqNote}</div>
                  <pre className="reqjson">{JSON.stringify(lastRequest.body, null, 2)}</pre>
                </div>
              })()}
            </details>
            <div className="row">
              <button className="btn primary" onClick={save}>{t.save}</button>
              <button className="btn" onClick={() => setP({})}>{t.resetToGlobal}</button>
              <button className="btn" onClick={onClose}>{t.cancel}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
