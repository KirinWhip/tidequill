import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import type { ProviderConfig } from '../../shared/types'
import { listModels } from '../../shared/providers'
import { api, bridgeFetch } from '../api'
import { useT } from '../i18n'
import { groupModels } from '../../shared/modelgroups'

type Cache = Record<string, { models: string[]; at: number }>
let memCache: Cache | null = null
const TTL = 24 * 3600 * 1000
async function loadCache(): Promise<Cache> { if (!memCache) memCache = (await api.kvGet('modelCache')) || {}; return memCache! }
const cacheKey = (p: ProviderConfig) => `${p.id}|${p.baseURL}`

/** fetch the provider's model list (OpenAI /v1/models, Anthropic /v1/models, Gemini models, Ollama /api/tags), cached for 24h */
export async function getModels(p: ProviderConfig, force = false): Promise<string[]> {
  const c = await loadCache()
  const hit = c[cacheKey(p)]
  if (hit && !force && Date.now() - hit.at < TTL) return hit.models
  const models = await listModels(p, bridgeFetch)
  c[cacheKey(p)] = { models, at: Date.now() }
  api.kvSet('modelCache', c)
  return models
}

export function ModelSelector({ providers, providerId, model, onChange }: { providers: ProviderConfig[]; providerId: string; model: string; onChange(providerId: string, model: string): void }) {
  const t = useT()
  const provider = providers.find(p => p.id === providerId) || providers[0]
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [remote, setRemote] = useState<string[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const fetchModels = (force = false) => {
    setState('loading')
    getModels(provider, force).then(m => { setRemote(m); setState('idle') }).catch(() => setState('error'))
  }
  useEffect(() => { if (open) { setQ(''); setHi(0); fetchModels(); setTimeout(() => input.current?.focus(), 0) } }, [open, provider?.id])
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [open])

  const all = useMemo(() => [...new Set([...(provider?.models || []), ...remote])].filter(m => !provider?.hiddenModels?.includes(m)), [provider, remote])
  const list = useMemo(() => { const s = q.trim().toLowerCase(); return s ? all.filter(m => m.toLowerCase().includes(s)) : all }, [all, q])
  const custom = q.trim() && !all.includes(q.trim()) ? q.trim() : ''
  // B8: grouped by family, newest first; older models collapsed per family (all shown while searching)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const groups = useMemo(() => groupModels(list, model), [list, model])
  const searching = !!q.trim()
  const visible = (g: { family: string; recent: string[]; older: string[] }) => searching || expanded[g.family] ? [...g.recent, ...g.older] : g.recent
  const options = [...(custom ? [custom] : []), ...groups.flatMap(visible)]
  const pick = (m: string) => { onChange(provider.id, m); setOpen(false) }

  return (
    <div className="modelsel" ref={box}>
      <select className="provsel" title={t.provider} aria-label={t.provider} value={provider?.id}
        onChange={e => { const p = providers.find(x => x.id === e.target.value)!; onChange(p.id, p.models[0] || model) }}>
        {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="modelbtn" title={t.model} aria-label={t.model} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="modelname">{model || t.model}</span><ChevronDown size={14} />
      </button>
      {open && <div className="popover modelpop" role="listbox">
        <div className="modelsearch">
          <input ref={input} value={q} placeholder={t.modelSearch} aria-label={t.modelSearch}
            onChange={e => { setQ(e.target.value); setHi(0) }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, options.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
              if (e.key === 'Enter' && options[hi]) { e.preventDefault(); pick(options[hi]) }
              if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
            }} />
          <button className="icon-btn sm" title={t.modelsRefresh} aria-label={t.modelsRefresh} onClick={() => fetchModels(true)}>
            {state === 'loading' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
        {state === 'loading' && <div className="hint pad">{t.modelsLoading}</div>}
        {state === 'error' && <div className="hint pad warn">{t.modelsFetchFailed}</div>}
        <div className="modellist" data-testid="model-list">
          {custom && <div role="option" aria-selected={false} className={'modelopt custom' + (hi === 0 ? ' hi' : '')} onMouseEnter={() => setHi(0)} onClick={() => pick(custom)}><span>{t.useCustomModel}<b>{custom}</b></span></div>}
          {groups.map(g => <div key={g.family} className="modelgroup" data-family={g.family || 'other'}>
            <div className="modelgroup-head">{g.family || t.modelsOther}</div>
            {visible(g).map(m => { const i = options.indexOf(m); return <div key={m} role="option" aria-selected={m === model} className={'modelopt' + (i === hi ? ' hi' : '')}
              onMouseEnter={() => setHi(i)} onClick={() => pick(m)}><span>{m}</span>{m === model && <Check size={14} />}</div> })}
            {!searching && g.older.length > 0 && <button className="modelolder" data-testid="model-older" onClick={() => setExpanded(x => ({ ...x, [g.family]: !x[g.family] }))}>
              <ChevronRight size={12} className={expanded[g.family] ? 'rot' : ''} />{expanded[g.family] ? t.modelsHideOlder : t.modelsShowOlder.replace('{n}', String(g.older.length))}</button>}
          </div>)}
          {!options.length && state !== 'loading' && <div className="hint pad">{t.noModels}</div>}
        </div>
      </div>}
    </div>
  )
}
