import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { McpServerConfig, ToolDef } from '../src/shared/types'

/** Plugin API: a plugin is a CommonJS file in <userData>/plugins exporting
 *  { name, description?, tools: [{ name, description, parameters, execute(args) => string|Promise<string> }] } */
export interface PluginTool extends ToolDef { execute(args: any): any }
export interface Plugin { name: string; description?: string; tools: PluginTool[] }

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

export class ToolManager {
  plugins: Plugin[] = [builtin]
  mcp = new Map<string, McpConn>()
  constructor(private pluginDir: string) {}

  loadPlugins() {
    this.plugins = [builtin]
    fs.mkdirSync(this.pluginDir, { recursive: true })
    for (const f of fs.readdirSync(this.pluginDir)) {
      if (!f.endsWith('.js')) continue
      try {
        const p = path.join(this.pluginDir, f)
        delete require.cache[p]
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = createRequire(__filename)(p)
        const plug: Plugin = mod.default || mod
        if (plug?.name && Array.isArray(plug.tools)) this.plugins.push(plug)
      } catch (e) { console.error('plugin load failed', f, e) }
    }
  }

  async syncMcp(servers: McpServerConfig[]) {
    for (const [id, c] of this.mcp) {
      const n = servers.find(s => s.id === id)
      if (!n || !n.enabled || JSON.stringify(n) !== JSON.stringify(c.cfg)) { await c.client?.close().catch(() => {}); this.mcp.delete(id) }
    }
    await Promise.all(servers.filter(s => s.enabled && !this.mcp.has(s.id)).map(s => this.connect(s)))
  }

  private async connect(cfg: McpServerConfig) {
    const conn: McpConn = { cfg, tools: [], status: 'connecting' }
    this.mcp.set(cfg.id, conn)
    try {
      const client = new Client({ name: 'chatbox-clone', version: '0.1.0' })
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
      plugins: this.plugins.map(p => ({ name: p.name, description: p.description, tools: p.tools.map(t => t.name) })),
      mcp: [...this.mcp.values()].map(c => ({ id: c.cfg.id, name: c.cfg.name, status: c.status, error: c.error, tools: c.tools.map(t => t.name) })),
    }
  }

  /** tool names are namespaced: plugin__tool / mcp_<server>__tool (sanitized to [a-zA-Z0-9_-]) */
  listTools(): ToolDef[] {
    const s = (x: string) => x.replace(/[^a-zA-Z0-9_-]/g, '_')
    const out: ToolDef[] = []
    for (const p of this.plugins) for (const t of p.tools) out.push({ name: `${s(p.name)}__${t.name}`.slice(0, 64), description: t.description, parameters: t.parameters })
    for (const c of this.mcp.values()) for (const t of c.tools) out.push({ name: `mcp_${s(c.cfg.name)}__${t.name}`.slice(0, 64), description: t.description, parameters: t.parameters })
    return out
  }

  async callTool(name: string, args: any): Promise<string> {
    const s = (x: string) => x.replace(/[^a-zA-Z0-9_-]/g, '_')
    try {
      for (const p of this.plugins) for (const t of p.tools) if (`${s(p.name)}__${t.name}`.slice(0, 64) === name) return String(await t.execute(args))
      for (const c of this.mcp.values()) for (const t of c.tools) if (`mcp_${s(c.cfg.name)}__${t.name}`.slice(0, 64) === name) {
        const r: any = await c.client!.callTool({ name: t.name, arguments: args })
        return (r.content || []).map((x: any) => x.type === 'text' ? x.text : JSON.stringify(x)).join('\n')
      }
      return `Tool not found: ${name}`
    } catch (e: any) { return `Tool error: ${e?.message || e}` }
  }
}
