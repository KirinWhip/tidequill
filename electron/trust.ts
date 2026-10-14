import crypto from 'node:crypto'
import fs from 'node:fs'
import { atomicWrite } from './store'
import type { McpServerConfig } from '../src/shared/types'

/** userData/trust.json (Round 2 · D, items 21-22)
 *  plugins: absolute plugin path -> SHA-256 the user confirmed (a changed file needs a new confirmation)
 *  mcp:     stdio server id -> hash of the exact command line + env the user confirmed
 *  grants:  "always allow" tool grants, scoped per source + tool: "<source>::<tool>" with
 *           source = "plugin:<plugin name>" or "mcp:<server id>" */
export interface TrustFile { plugins: Record<string, string>; mcp: Record<string, string>; grants: string[] }

export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex')
export const fileSha256 = (f: string) => sha256(fs.readFileSync(f))
/** what the user confirms for a stdio server: command, args and env (values included: they are part of what runs) */
export const mcpCommandHash = (c: Pick<McpServerConfig, 'command' | 'args' | 'env'>) => sha256(JSON.stringify([c.command || '', c.args || [], c.env || {}]))
export const grantKey = (source: string, tool: string) => `${source}::${tool}`
export const isScopedGrant = (g: unknown): g is string => typeof g === 'string' && /^(plugin|mcp):[^:]+::.+$/.test(g)

export class TrustStore {
  constructor(private file: string, private legacyAllowFile?: string) {}
  read(): TrustFile {
    let t: any
    try { t = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { t = {} }
    const out: TrustFile = { plugins: t.plugins && typeof t.plugins === 'object' ? t.plugins : {}, mcp: t.mcp && typeof t.mcp === 'object' ? t.mcp : {}, grants: Array.isArray(t.grants) ? t.grants.filter(isScopedGrant) : [] }
    // pre-1.0.1 grants (tool-allowlist.json) were plain tool names without a server scope: they are dropped
    if (this.legacyAllowFile && fs.existsSync(this.legacyAllowFile)) { try { fs.rmSync(this.legacyAllowFile) } catch { /* ignore */ } }
    return out
  }
  update(fn: (t: TrustFile) => void): TrustFile { const t = this.read(); fn(t); atomicWrite(this.file, JSON.stringify(t, null, 2)); return t }
}
