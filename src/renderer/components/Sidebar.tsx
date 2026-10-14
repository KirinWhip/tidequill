import { useEffect, useMemo, useState, type RefObject } from 'react'
import {
  MessageSquarePlus, Search, Settings as SettingsIcon, Users, BookOpen, Image as ImageIcon, Puzzle, FileInput, FileOutput, Pin, PinOff, Pencil, Trash2,
  MessageSquare, Folder as FolderIcon, FolderPlus, FolderOpen, ChevronRight, CheckSquare, Square, Tag, FileDown, SlidersHorizontal, MoreHorizontal, Download, Loader2, Info,
} from 'lucide-react'
import type { Conversation, Folder } from '../../shared/types'
import { searchConversations, searchSnippet, sortConversations, uid } from '../../shared/storage'
import { useT } from '../i18n'

interface Props {
  convs: Conversation[]; folders: Folder[]; curId: string; busyId: string; searchRef: RefObject<HTMLInputElement>
  onSelect(id: string): void; onNew(): void; onPatch(id: string, fn: (c: Conversation) => Conversation): void; onDelete(ids: string[]): void
  onFolders(f: Folder[]): void; onOpenSettings(id: string): void; onModal(m: string): void; onImport(): void; onExportAll(): void; onExportMd(c: Conversation): void
  update: any; onUpdate(): void
}
type Menu = { x: number; y: number; kind: 'conv'; id: string } | { x: number; y: number; kind: 'folder'; id: string } | null

export function Sidebar(p: Props) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [menu, setMenu] = useState<Menu>(null)
  const [editingId, setEditingId] = useState('')
  const [editingFolder, setEditingFolder] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [updating, setUpdating] = useState(false)
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close); window.addEventListener('blur', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close) }
  }, [menu])

  const allTags = useMemo(() => [...new Set(p.convs.flatMap(c => c.tags || []))].sort(), [p.convs])
  const filtered = useMemo(() => {
    let l = sortConversations(p.convs)
    if (tag) l = l.filter(c => (c.tags || []).includes(tag))
    return searchConversations(l, query)
  }, [p.convs, query, tag])
  const flat = !!query.trim() || !!tag
  const groups: { folder: Folder | null; items: Conversation[] }[] = flat ? [{ folder: null, items: filtered }] : [
    ...p.folders.map(f => ({ folder: f, items: filtered.filter(c => c.folderId === f.id) })),
    { folder: null, items: filtered.filter(c => !c.folderId || !p.folders.some(f => f.id === c.folderId)) },
  ]
  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const navItems: [string, any, string][] = [
    ['personas', Users, t.personas], ['prompts', BookOpen, t.prompts], ['images', ImageIcon, t.images], ['tools', Puzzle, t.tools],
    ['import', FileInput, t.importData], ['export', FileOutput, t.exportJson], ['settings', SettingsIcon, t.settings], ['about', Info, t.about],
  ]
  const menuConv = menu?.kind === 'conv' ? p.convs.find(c => c.id === menu.id) : undefined
  const menuFolder = menu?.kind === 'folder' ? p.folders.find(f => f.id === menu.id) : undefined

  return (
    <aside className="sidebar">
      <div className="brand"><img src="./logo.png" alt="" width={22} height={22} className="brand-logo" />{t.brand}</div>
      {p.update && <div className="updatebar"><Download size={14} /><span>{t.updateAvailable}{p.update.latest}</span>
        <button className="btn primary sm" disabled={updating} onClick={() => { setUpdating(true); p.onUpdate() }}>{updating ? <Loader2 size={13} className="spin" /> : t.updateDownload}</button></div>}
      <button className="btn primary block" onClick={p.onNew}><MessageSquarePlus size={16} />{t.newChat}</button>
      <div className="searchbox"><Search size={14} /><input ref={p.searchRef} placeholder={t.search} aria-label={t.search} value={query} onChange={e => setQuery(e.target.value)} /></div>
      {allTags.length > 0 && <div className="tagbar">
        <button className={'tagchip' + (!tag ? ' on' : '')} onClick={() => setTag('')}>{t.allTags}</button>
        {allTags.map(x => <button key={x} className={'tagchip' + (tag === x ? ' on' : '')} onClick={() => setTag(tag === x ? '' : x)}><Tag size={11} />{x}</button>)}
      </div>}
      <div className="listhead">
        <span className="meta">{selecting ? t.selectedCount.replace('{n}', String(selected.size)) : t.folders}</span>
        <span className="spacer" />
        {!selecting && <button className="icon-btn sm" title={t.newFolder} aria-label={t.newFolder} onClick={() => { const f = { id: uid(), name: t.newFolder }; p.onFolders([...p.folders, f]); setEditingFolder(f.id) }}><FolderPlus size={15} /></button>}
        <button className={'icon-btn sm' + (selecting ? ' active' : '')} title={selecting ? t.selectDone : t.select} aria-label={selecting ? t.selectDone : t.select}
          onClick={() => { setSelecting(!selecting); setSelected(new Set()) }}><CheckSquare size={15} /></button>
      </div>
      <div className="convlist">
        {groups.map(g => (g.folder || g.items.length > 0 || !flat) && <div key={g.folder?.id || 'none'} className="group">
          {g.folder && <div className="folderhead" onClick={() => p.onFolders(p.folders.map(f => f.id === g.folder!.id ? { ...f, collapsed: !f.collapsed } : f))}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, kind: 'folder', id: g.folder!.id }) }}>
            <ChevronRight size={13} className={'chev' + (g.folder.collapsed ? '' : ' open')} />
            {g.folder.collapsed ? <FolderIcon size={14} /> : <FolderOpen size={14} />}
            {editingFolder === g.folder.id
              ? <input autoFocus defaultValue={g.folder.name} aria-label={t.folderName} onClick={e => e.stopPropagation()}
                  onBlur={e => { p.onFolders(p.folders.map(f => f.id === g.folder!.id ? { ...f, name: e.target.value || f.name } : f)); setEditingFolder('') }}
                  onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
              : <span className="title">{g.folder.name}</span>}
            <span className="meta">{g.items.length}</span>
          </div>}
          {!flat && !g.folder && p.folders.length > 0 && g.items.length > 0 && <div className="folderhead plain"><MessageSquare size={13} /><span className="title">{t.noFolder}</span></div>}
          {!(g.folder?.collapsed) && g.items.map(c => <ConvItem key={c.id} c={c} active={c.id === p.curId} busy={p.busyId === c.id} editing={editingId === c.id} snippet={query ? searchSnippet(c, query) : ''}
            selecting={selecting} selected={selected.has(c.id)} indent={!!g.folder}
            onClick={() => selecting ? toggleSel(c.id) : p.onSelect(c.id)}
            onRename={title => { p.onPatch(c.id, x => ({ ...x, title: title || x.title })); setEditingId('') }}
            onStartRename={() => setEditingId(c.id)}
            onPin={() => p.onPatch(c.id, x => ({ ...x, pinned: !x.pinned }))}
            onDelete={() => { if (confirm(t.confirmDelete)) p.onDelete([c.id]) }}
            onMenu={(x, y) => setMenu({ x, y, kind: 'conv', id: c.id })} />)}
        </div>)}
      </div>
      {selecting && <div className="selectbar">
        <button className="btn danger" disabled={!selected.size} onClick={() => {
          if (confirm(t.confirmBatchDelete.replace('{n}', String(selected.size)))) { p.onDelete([...selected]); setSelected(new Set()); setSelecting(false) }
        }}><Trash2 size={14} />{t.deleteSelected} ({selected.size})</button>
      </div>}
      <nav className="sidenav">
        {navItems.map(([k, Icon, label]) => <button key={k} onClick={() => k === 'import' ? p.onImport() : k === 'export' ? p.onExportAll() : p.onModal(k)}><Icon size={16} />{label}</button>)}
      </nav>
      {menu && <div className="ctxmenu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 330) }} onClick={e => e.stopPropagation()}>
        {menuConv && <>
          <button role="menuitem" onClick={() => { setEditingId(menuConv.id); setMenu(null) }}><Pencil size={14} />{t.rename}</button>
          <button role="menuitem" onClick={() => { p.onPatch(menuConv.id, x => ({ ...x, pinned: !x.pinned })); setMenu(null) }}>{menuConv.pinned ? <PinOff size={14} /> : <Pin size={14} />}{menuConv.pinned ? t.unpin : t.pin}</button>
          <button role="menuitem" onClick={() => { p.onOpenSettings(menuConv.id); setMenu(null) }}><SlidersHorizontal size={14} />{t.convSettings}</button>
          <button role="menuitem" onClick={() => { p.onOpenSettings(menuConv.id); setMenu(null) }}><Tag size={14} />{t.editTags}</button>
          <div className="ctxsep" /><div className="ctxlabel">{t.moveTo}</div>
          <button role="menuitem" className={!menuConv.folderId ? 'cur' : ''} onClick={() => { p.onPatch(menuConv.id, x => ({ ...x, folderId: undefined })); setMenu(null) }}><MessageSquare size={14} />{t.noFolder}</button>
          {p.folders.map(f => <button key={f.id} role="menuitem" className={menuConv.folderId === f.id ? 'cur' : ''} onClick={() => { p.onPatch(menuConv.id, x => ({ ...x, folderId: f.id })); setMenu(null) }}><FolderIcon size={14} />{f.name}</button>)}
          <div className="ctxsep" />
          <button role="menuitem" onClick={() => { p.onExportMd(menuConv); setMenu(null) }}><FileDown size={14} />{t.exportMd}</button>
          <button role="menuitem" className="danger-item" onClick={() => { setMenu(null); if (confirm(t.confirmDelete)) p.onDelete([menuConv.id]) }}><Trash2 size={14} />{t.delete}</button>
        </>}
        {menuFolder && <>
          <button role="menuitem" onClick={() => { setEditingFolder(menuFolder.id); setMenu(null) }}><Pencil size={14} />{t.renameFolder}</button>
          <button role="menuitem" className="danger-item" onClick={() => {
            p.onFolders(p.folders.filter(f => f.id !== menuFolder.id))
            p.convs.filter(c => c.folderId === menuFolder.id).forEach(c => p.onPatch(c.id, x => ({ ...x, folderId: undefined })))
            setMenu(null)
          }}><Trash2 size={14} />{t.deleteFolder}</button>
        </>}
      </div>}
    </aside>
  )
}

function ConvItem({ c, active, busy, editing, snippet, selecting, selected, indent, onClick, onRename, onStartRename, onPin, onDelete, onMenu }: {
  c: Conversation; active: boolean; busy: boolean; editing: boolean; snippet: string; selecting: boolean; selected: boolean; indent: boolean
  onClick(): void; onRename(s: string): void; onStartRename(): void; onPin(): void; onDelete(): void; onMenu(x: number, y: number): void
}) {
  const t = useT()
  return (
    <div className={'conv' + (active ? ' active' : '') + (indent ? ' indent' : '') + (selected ? ' selected' : '')} onClick={onClick}
      onContextMenu={e => { e.preventDefault(); onMenu(e.clientX, e.clientY) }} data-conv-id={c.id}>
      <ConvIcon selecting={selecting} selected={selected} busy={busy} pinned={c.pinned} />
      <div className="convtext">
        {editing ? <input autoFocus defaultValue={c.title} aria-label={t.rename} onClick={e => e.stopPropagation()} onBlur={e => onRename(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          : <span className="title">{c.title}</span>}
        {snippet && <span className="snippet">{snippet}</span>}
        {!!c.tags?.length && !snippet && <span className="convtags">{c.tags.map(x => <span key={x} className="minitag">{x}</span>)}</span>}
      </div>
      {!selecting && <span className="acts">
        <button className="icon-btn sm" title={t.rename} aria-label={t.rename} onClick={e => { e.stopPropagation(); onStartRename() }}><Pencil size={13} /></button>
        <button className="icon-btn sm" title={c.pinned ? t.unpin : t.pin} aria-label={c.pinned ? t.unpin : t.pin} onClick={e => { e.stopPropagation(); onPin() }}>{c.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
        <button className="icon-btn sm" title={t.delete} aria-label={t.delete} onClick={e => { e.stopPropagation(); onDelete() }}><Trash2 size={13} /></button>
        <button className="icon-btn sm" title={t.more} aria-label={t.more} onClick={e => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMenu(r.left, r.bottom) }}><MoreHorizontal size={13} /></button>
      </span>}
    </div>
  )
}

function ConvIcon({ selecting, selected, busy, pinned }: { selecting: boolean; selected: boolean; busy: boolean; pinned: boolean }) {
  if (selecting) return selected ? <CheckSquare size={14} className="pinmark" /> : <Square size={14} className="convicon" />
  if (busy) return <Loader2 size={13} className="spin convicon" />
  return pinned ? <Pin size={13} className="pinmark" /> : <MessageSquare size={13} className="convicon" />
}
