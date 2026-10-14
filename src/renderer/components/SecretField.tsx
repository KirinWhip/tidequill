import { useState } from 'react'
import { Check, Eye, EyeOff, Pencil, Trash2, X } from 'lucide-react'
import { api } from '../api'
import { useT } from '../i18n'

/** Round 3 · A6: a saved secret is never shown or sent to the renderer: the field only knows "saved" (a placeholder
 *  from main) and offers 替换 / 清除. While typing a NEW value, show / hide is allowed; 保存 sends it to main once. */
export function SecretField({ path, value, onSaved, testid, placeholder, onTyping }: {
  path: string; value: string; onSaved(sentinel: string): void; testid: string; placeholder?: string; onTyping?(v: string): void
}) {
  const t = useT()
  const saved = !!value
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const v = draft.trim(); if (!v) return
    setBusy(true)
    try { const s = await api.secretSet(path, v); onSaved(s); setDraft(''); setEditing(false); setShow(false); onTyping?.('') } finally { setBusy(false) }
  }
  const clear = async () => { if (!confirm(t.secretClearConfirm)) return; const s = await api.secretSet(path, ''); onSaved(s); setEditing(false) }
  if (saved && !editing) return <div className="secretfield saved" data-testid={testid + '-saved'}>
    <span className="secret-state" data-testid={testid + '-state'}><Check size={13} />{t.secretSaved}</span>
    <button className="btn sm" data-testid={testid + '-replace'} onClick={() => { setEditing(true); setDraft('') }}><Pencil size={12} />{t.secretReplace}</button>
    <button className="btn sm danger" data-testid={testid + '-clear'} onClick={clear}><Trash2 size={12} />{t.secretClear}</button>
  </div>
  return <div className="secretfield">
    <div className="keyfield">
      <input type={show ? 'text' : 'password'} data-testid={testid} value={draft} placeholder={placeholder} autoComplete="off" spellCheck={false} autoFocus={editing}
        onChange={e => { setDraft(e.target.value); onTyping?.(e.target.value) }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } if (e.key === 'Escape' && editing) { e.stopPropagation(); setEditing(false) } }} />
      <button className="icon-btn sm" data-testid={testid + '-toggle'} title={show ? t.hideKey : t.showKey} aria-label={show ? t.hideKey : t.showKey} onClick={() => setShow(!show)}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
    </div>
    <button className="btn sm primary" data-testid={testid + '-save'} disabled={!draft.trim() || busy} onClick={save}><Check size={12} />{t.secretSave}</button>
    {editing && <button className="btn sm" data-testid={testid + '-cancel'} onClick={() => { setEditing(false); setDraft(''); onTyping?.('') }}><X size={12} />{t.cancel}</button>}
  </div>
}
