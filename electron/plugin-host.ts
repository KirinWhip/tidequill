/** Plugin host process (Round 2 · D, item 21). Bundled to dist-electron/plugin-host.js and started by the main
 *  process with utilityProcess.fork (Electron) — plugins never run inside the main process. Also works under
 *  child_process.fork (unit tests). Only plugins the user confirmed (path + SHA-256) are sent here; the file hash is
 *  checked again right before require() so a file swapped after confirmation is not loaded.
 *  NOTE: this is process isolation (a crash, hang or memory leak in a plugin cannot take down the app, and plugins
 *  have no access to the main process' objects, windows, IPC or decrypted settings), not a sandbox: a plugin still
 *  runs as Node.js code with the user's file-system and network permissions. */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'

type Msg = { id: number; op: 'load'; files: { path: string; sha256: string }[] } | { id: number; op: 'call'; file: string; tool: string; args: any } | { id: number; op: 'ping' }
const loaded = new Map<string, any>()
const req = createRequire(__filename)

export async function handle(m: Msg): Promise<any> {
  if (m.op === 'ping') return { id: m.id, ok: true, pid: process.pid }
  if (m.op === 'load') {
    loaded.clear()
    const plugins: any[] = []; const errors: any[] = []
    for (const f of m.files) {
      try {
        const sha = crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex')
        if (sha !== f.sha256) throw new Error('file changed since it was confirmed (SHA-256 mismatch)')
        delete req.cache[f.path]
        const mod = req(f.path); const plug = mod?.default || mod
        if (!plug?.name || !Array.isArray(plug.tools)) throw new Error('not a plugin: expected { name, tools: [] }')
        loaded.set(f.path, plug)
        plugins.push({ file: f.path, name: String(plug.name), description: plug.description ? String(plug.description) : undefined,
          tools: plug.tools.filter((t: any) => t?.name && typeof t.execute === 'function').map((t: any) => ({ name: String(t.name), description: String(t.description || ''), parameters: t.parameters || { type: 'object', properties: {} } })) })
      } catch (e: any) { errors.push({ file: f.path, error: String(e?.message || e) }) }
    }
    return { id: m.id, ok: true, plugins, errors, pid: process.pid }
  }
  if (m.op === 'call') {
    const t = loaded.get(m.file)?.tools?.find((x: any) => x.name === m.tool)
    if (!t) return { id: m.id, ok: false, error: `Tool not found: ${m.tool}` }
    try { return { id: m.id, ok: true, result: String(await t.execute(m.args ?? {})) } } catch (e: any) { return { id: m.id, ok: false, error: String(e?.message || e) } }
  }
  return { id: (m as any).id, ok: false, error: 'unknown op' }
}

const port: any = (process as any).parentPort
if (port) port.on('message', async (e: any) => port.postMessage(await handle(e.data)))
else if (process.send) process.on('message', async (m: any) => process.send!(await handle(m)))
