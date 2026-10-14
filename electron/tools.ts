import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import fs from 'node:fs'
import path from 'node:path'
import type { McpServerConfig, ToolDef } from '../src/shared/types'
import type { PluginHostClient } from './plugin-client'
import { fileSha256, mcpCommandHash, type TrustStore } from './trust'

/** Plugin API: a plugin is a CommonJS file in <userData>/plugins exporting
 *  { name, description?, tools: [{ name, description, parameters, execute(args) => string|Promise<string> }] }
 *  User plugins run in a separate utility process (plugin-host.ts) and only after the user confirmed path + SHA-256. */
export interface PluginTool extends ToolDef { execute?(args: any): any }
export interface Plugin { name: string; description?: string; file?: string; tools: PluginTool[] }
export interface PendingPlugin { file: string; path: string; sha256: string; changed: boolean }

const builtin: Plugin = {
  name: 'builtin',
  description: 'Built-in tools',
  tools: [
    { name: 'get_current_time', description: 'Get the current local date and time', parameters: { type: 'object', properties: {} }, execute: () => new Date().toString() },
    {
      name: 'calculator', description: 'Evaluate a basic arithmetic expression, e.g. "2*(3+4)"',
      parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
      execute: ({ expression }: any) => {
        if (!/^[\d+\-*/().%\s^e]+$/i.test(String(expression))) return 'Invalid expression'
        return String(Function(`"use strict";return (${String(expression).replace(/\^/g, '**')})`)())
      },
    },
  ],
}

interface McpConn { cfg: McpServerConfig; client?: Client; tools: ToolDef[]; status: string; error?: string }
const s_ = (x: string) => x.replace(/[^a-zA-Z0-9_-]/g, '_')
/** the exact command line shown to the user before a stdio server may start */
export function commandLine(cfg: Pick<McpServerConfig, 'command' | 'args'>) {
  const q = (a: string) => /^[\w@%+=:,./~\\-]+$/.test(a) ? a : JSON.stringify(a)
  return [cfg.command || '', ...(cfg.args || [])].map(q).join(' ')
}

export class ToolManager {
  plugins: Plugin[] = [builtin]
  pending: PendingPlugin[] = []
  pluginErrors: { file: string; error: string }[] = []
  mcp = new Map<string, McpConn>()
  constructor(private pluginDir: string, private host: PluginHostClient, private trust: TrustStore) {}

  /** scan the plugin folder; confirmed (path + unchanged SHA-256) plugins are loaded in the plugin host,
   *  new or modified files wait for confirmation */
  async loadPlugins() {
    fs.mkdirSync(this.pluginDir, { recursive: true })
    const trusted = this.trust.read().plugins
    const ok: { path: string; sha256: string }[] = []; const pending: PendingPlugin[] = []
    for (const f of fs.readdirSync(this.pluginDir).sort()) {
      if (!f.endsWith('.js')) continue
      const p = path.join(this.pluginDir, f)
      let sha: string
      try { sha = fileSha256(p) } catch { continue }
      if (trusted[p] === sha) ok.push({ path: p, sha256: sha })
      else pending.push({ file: f, path: p, sha256: sha, changed: !!trusted[p] })
    }
    this.pending = pending
    try {
      const r = await this.host.load(ok)
      this.plugins = [builtin, ...r.plugins.map((x: any) => ({ ...x }))]
      this.pluginErrors = r.errors || []
    } catch (e: any) { this.plugins = [builtin]; this.pluginErrors = ok.map(o => ({ file: o.path, error: String(e?.message || e) })) }
  }

  async syncMcp(servers: McpServerConfig[]) {
    for (const [id, c] of this.mcp) {
      const n = servers.find(s => s.id === id)
      if (!n || !n.enabled || JSON.stringify(n) !== JSON.stringify(c.cfg) || c.status === 'needs-approval') { await c.client?.close().catch(() => {}); this.mcp.delete(id) }
    }
    await Promise.all(servers.filter(s => s.enabled && !this.mcp.has(s.id)).map(s => this.connect(s)))
  }

  private async connect(cfg: McpServerConfig) {
    const conn: McpConn = { cfg, tools: [], status: 'connecting' }
    this.mcp.set(cfg.id, conn)
    // a stdio server starts a local program: it only runs after the user confirmed this exact command line
    if (cfg.type === 'stdio' && this.trust.read().mcp[cfg.id] !== mcpCommandHash(cfg)) { conn.status = 'needs-approval'; return }
    try {
      const client = new Client({ name: 'tidequill', version: '1.0.1' })
      if (cfg.type === 'stdio') {
        await client.connect(new StdioClientTransport({ command: cfg.command!, args: cfg.args || [], env: { ...process.env, ...(cfg.env || {}) } as any }))
      } else {
        try { await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url!))) }
        catch { await client.connect(new SSEClientTransport(new URL(cfg.url!))) }
      }
      const { tools } = await client.listTools()
      conn.client = client
      conn.tools = tools.map(t => ({ name: t.name, description: t.description || '', parameters: t.inputSchema as any }))
      conn.status = 'connected'
    } catch (e: any) { conn.status = 'error'; conn.error = String(e?.message || e) }
  }

  status() {
    return {
      plugins: this.plugins.map(p => ({ name: p.name, description: p.description, file: p.file, tools: p.tools.map(t => t.name) })),
      pendingPlugins: this.pending, pluginErrors: this.pluginErrors,
      mcp: [...this.mcp.values()].map(c => ({ id: c.cfg.id, name: c.cfg.name, status: c.status, error: c.error, tools: c.tools.map(t => t.name) })),
    }
  }

  /** tool names are namespaced: plugin__tool / mcp_<server>__tool (sanitized to [a-zA-Z0-9_-]) */
  listTools(): ToolDef[] {
    const out: ToolDef[] = []
    for (const p of this.plugins) for (const t of p.tools) out.push({ name: `${s_(p.name)}__${t.name}`.slice(0, 64), description: t.description, parameters: t.parameters })
    for (const c of this.mcp.values()) for (const t of c.tools) out.push({ name: `mcp_${s_(c.cfg.name)}__${t.name}`.slice(0, 64), description: t.description, parameters: t.parameters })
    return out
  }

  /** which source a namespaced tool name belongs to: grants are scoped to "<source>::<tool>" */
  resolve(name: string): { source: string; label: string; tool: string } | null {
    for (const p of this.plugins) for (const t of p.tools) if (`${s_(p.name)}__${t.name}`.slice(0, 64) === name) return { source: `plugin:${p.name}`, label: p.file || p.name, tool: t.name }
    for (const c of this.mcp.values()) for (const t of c.tools) if (`mcp_${s_(c.cfg.name)}__${t.name}`.slice(0, 64) === name) return { source: `mcp:${c.cfg.id}`, label: c.cfg.name, tool: t.name }
    return null
  }

  async callTool(name: string, args: any): Promise<string> {
    try {
      for (const p of this.plugins) for (const t of p.tools) if (`${s_(p.name)}__${t.name}`.slice(0, 64) === name) {
        if (t.execute) return String(await t.execute(args)) // built-in tools
        return await this.host.call(p.file!, t.name, args)
      }
      for (const c of this.mcp.values()) for (const t of c.tools) if (`mcp_${s_(c.cfg.name)}__${t.name}`.slice(0, 64) === name) {
        const r: any = await c.client!.callTool({ name: t.name, arguments: args })
        return (r.content || []).map((x: any) => x.type === 'text' ? x.text : JSON.stringify(x)).join('\n')
      }
      return `Tool not found: ${name}`
    } catch (e: any) { return `Tool error: ${e?.message || e}` }
  }
}
