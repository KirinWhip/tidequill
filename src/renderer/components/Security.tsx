import { useEffect, useState } from 'react'
import { ShieldAlert, ShieldCheck, Terminal, Trash2, X, DatabaseBackup } from 'lucide-react'
import type { McpServerConfig } from '../../shared/types'
import type { Dict } from '../i18n'
import { api } from '../api'

export interface PendingPlugin { file: string; path: string; sha256: string; changed: boolean }
export interface TrustInfo { plugins: Record<string, string>; mcp: Record<string, string>; grants: string[] }

/** first load of a plugin (or a modified plugin file): show path + SHA-256 and ask before it runs */
export function PluginTrustModal({ p, t, onDone }: { p: PendingPlugin; t: Dict; onDone(loaded: boolean): void }) {
  const [err, setErr] = useState('')
  return (
    <div className="overlay top" role="dialog" aria-modal="true" aria-labelledby="plugin-trust-title">
      <div className="modal narrow" data-testid="plugin-trust">
        <h2 id="plugin-trust-title" className="withicon"><ShieldAlert size={20} />{t.pluginTrustTitle}</h2>
        {p.changed && <div className="notice warn" data-testid="plugin-changed">{t.pluginTrustChanged}</div>}
        <p className="meta">{t.pluginTrustBody}</p>
        <dl className="kv">
          <dt>{t.pluginPath}</dt><dd><code data-testid="plugin-trust-path">{p.path}</code></dd>
          <dt>{t.sha256}</dt><dd><code className="hash" data-testid="plugin-trust-sha">{p.sha256}</code></dd>
        </dl>
        {err && <div className="error">{err}</div>}
        <div className="row end">
          <button data-testid="plugin-trust-deny" onClick={() => onDone(false)}>{t.notNow}</button>
          <button className="primary" data-testid="plugin-trust-allow" onClick={async () => { const r = await api.trustPlugin(p.path, p.sha256); if (r?.ok) onDone(true); else setErr(String(r?.error || '')) }}>{t.trustLoad}</button>
        </div>
      </div>
    </div>
  )
}

/** stdio MCP server: the exact command line + args (+ env names) must be confirmed before it is started */
export function McpConfirmModal({ cfg, t, onCancel, onApproved }: { cfg: McpServerConfig; t: Dict; onCancel(): void; onApproved(): void }) {
  const [pv, setPv] = useState<{ commandLine: string; envKeys: string[] } | null>(null)
  useEffect(() => { api.mcpPreview(cfg).then(setPv) }, [cfg])
  return (
    <div className="overlay top" role="dialog" aria-modal="true" aria-labelledby="mcp-confirm-title">
      <div className="modal narrow" data-testid="mcp-confirm">
        <h2 id="mcp-confirm-title" className="withicon"><Terminal size={20} />{t.mcpConfirmTitle}</h2>
        <p className="meta">{t.mcpConfirmBody}</p>
        <dl className="kv">
          <dt>{t.name}</dt><dd>{cfg.name}</dd>
          <dt>{t.mcpCommandLine}</dt><dd><pre className="cmdline" data-testid="mcp-confirm-cmd">{pv?.commandLine}</pre></dd>
          <dt>{t.args}</dt><dd><ol className="argv" data-testid="mcp-confirm-args">{(cfg.args || []).map((a, i) => <li key={i}><code>{a}</code></li>)}</ol></dd>
          {!!pv?.envKeys.length && <><dt>{t.mcpEnvKeys}</dt><dd><code>{pv.envKeys.join(', ')}</code></dd></>}
        </dl>
        <div className="row end">
          <button data-testid="mcp-confirm-cancel" onClick={onCancel}>{t.cancel}</button>
          <button className="primary" data-testid="mcp-confirm-ok" onClick={async () => { await api.mcpApprove(cfg); onApproved() }}>{t.approveRun}</button>
        </div>
      </div>
    </div>
  )
}

/** grants page: scoped "always allow" grants, trusted plugins, confirmed MCP commands; per item or all revoke */
export function GrantsSection({ t, servers, onChanged }: { t: Dict; servers: McpServerConfig[]; onChanged(): void }) {
  const [g, setG] = useState<TrustInfo>({ plugins: {}, mcp: {}, grants: [] })
  const refresh = () => api.toolGrants().then(setG)
  useEffect(() => { refresh(); const i = setInterval(refresh, 1500); return () => clearInterval(i) }, [])
  const label = (src: string) => src.startsWith('mcp:') ? (servers.find(s => s.id === src.slice(4))?.name || src.slice(4)) + ' (MCP)' : src.slice(7)
  const after = (p: Promise<any>) => p.then(() => { refresh(); onChanged() })
  const empty = !g.grants.length && !Object.keys(g.plugins).length && !Object.keys(g.mcp).length
  return (
    <section data-testid="grants">
      <h3 className="withicon"><ShieldCheck size={16} />{t.grants}</h3>
      <p className="hint">{t.grantsHint}</p>
      <h4>{t.grantTools}</h4>
      {g.grants.length === 0 ? <p className="hint">{t.none}</p> : <table className="sc grants"><thead><tr><th>{t.source}</th><th>{t.tool}</th><th /></tr></thead><tbody>
        {g.grants.map(k => { const [src, tool] = k.split('::'); return <tr key={k} data-testid="grant-row"><td>{label(src)}</td><td><code>{tool}</code></td>
          <td><button className="sm" data-testid="grant-revoke" onClick={() => after(api.revokeTool(k))}><X size={13} />{t.revoke}</button></td></tr> })}
      </tbody></table>}
      <h4>{t.grantPlugins}</h4>
      {Object.keys(g.plugins).length === 0 ? <p className="hint">{t.none}</p> : Object.entries(g.plugins).map(([p, sha]) => <div key={p} className="row grant-item" data-testid="trusted-plugin">
        <code>{p}</code><code className="hash" title={sha}>{sha.slice(0, 16)}</code>
        <button className="sm" data-testid="plugin-untrust" onClick={() => after(api.untrustPlugin(p))}><X size={13} />{t.revoke}</button></div>)}
      <h4>{t.grantMcp}</h4>
      {Object.keys(g.mcp).length === 0 ? <p className="hint">{t.none}</p> : Object.keys(g.mcp).map(id => <div key={id} className="row grant-item" data-testid="trusted-mcp">
        <span>{label('mcp:' + id)}</span>
        <button className="sm" data-testid="mcp-revoke" onClick={() => after(api.mcpRevoke(id))}><X size={13} />{t.revoke}</button></div>)}
      <div className="row"><button className="danger" data-testid="revoke-all" disabled={empty} onClick={() => after(api.revokeAllTools())}><Trash2 size={14} />{t.revokeAll}</button></div>
    </section>
  )
}

/** shown after a corrupt data file was detected at startup */
export function StorageNotices({ t }: { t: Dict }) {
  const [list, setList] = useState<any[]>([])
  useEffect(() => { api.storageNotices().then((l: any[]) => setList(l || [])) }, [])
  if (!list.length) return null
  return (
    <div className="storage-notice" role="alert" data-testid="storage-notice">
      <DatabaseBackup size={16} />
      <div>{list.map((n, i) => <div key={i}>{(n.kind === 'restored' ? t.storageRestored : t.storageReset).replace('{key}', n.key).replace('{backup}', n.backup || '').replace('{file}', n.corruptFile)}</div>)}</div>
      <button className="sm" data-testid="storage-notice-dismiss" onClick={() => { api.dismissStorageNotices(); setList([]) }}>{t.gotIt}</button>
    </div>
  )
}
