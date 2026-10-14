import { describe, it, expect, beforeAll } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { fork } from 'node:child_process'
import { buildSync } from 'esbuild'
import { ToolManager, commandLine } from '../electron/tools'
import { PluginHostClient, type Spawn } from '../electron/plugin-client'
import { TrustStore, fileSha256, mcpCommandHash, grantKey, isScopedGrant } from '../electron/trust'

// the real plugin host script, run as a separate Node process (Electron uses utilityProcess.fork for the same file)
let hostJs = ''
beforeAll(() => {
  hostJs = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'host-')), 'plugin-host.js')
  buildSync({ entryPoints: ['electron/plugin-host.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: hostJs, logLevel: 'silent' })
})
const spawn: Spawn = () => {
  const c = fork(hostJs, [], { stdio: 'ignore' })
  return { post: m => c.send(m), onMessage: cb => c.on('message', cb), onExit: cb => c.on('exit', cb), kill: () => { c.kill() }, get pid() { return c.pid } } as any
}
const setup = (timeout?: number) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plug-')); const dir = path.join(root, 'plugins'); fs.mkdirSync(dir)
  const trust = new TrustStore(path.join(root, 'trust.json'), path.join(root, 'tool-allowlist.json'))
  const host = new PluginHostClient(spawn, timeout)
  return { root, dir, trust, host, tm: new ToolManager(dir, host, trust) }
}
const HELLO = `module.exports = { name: 'hello', tools: [
  { name: 'greet', description: 'greet', parameters: { type: 'object', properties: {} }, execute: (a) => 'hi ' + a.who + ' from pid ' + process.pid },
  { name: 'crash', description: 'crash', parameters: {}, execute: () => process.exit(3) },
  { name: 'hang', description: 'hang', parameters: {}, execute: () => new Promise(() => {}) }] }`

describe('ToolManager + plugin host process', () => {
  it('a new plugin is NOT loaded until its path + SHA-256 is trusted; it then runs in a separate process', async () => {
    const { dir, trust, host, tm } = setup()
    const f = path.join(dir, 'hello.js'); fs.writeFileSync(f, HELLO)
    await tm.loadPlugins()
    expect(tm.listTools().map(t => t.name)).not.toContain('hello__greet')
    expect(tm.pending).toEqual([{ file: 'hello.js', path: f, sha256: fileSha256(f), changed: false }])
    trust.update(t => { t.plugins[f] = fileSha256(f) })
    await tm.loadPlugins()
    expect(tm.pending).toEqual([])
    expect(tm.listTools().map(t => t.name)).toEqual(expect.arrayContaining(['builtin__calculator', 'hello__greet']))
    expect(await tm.callTool('builtin__calculator', { expression: '2*(3+4)' })).toBe('14')
    const r = await tm.callTool('hello__greet', { who: 'bob' })
    expect(r).toMatch(/^hi bob from pid \d+$/)
    expect(Number(r.split(' ').pop())).not.toBe(process.pid)
    expect(tm.resolve('hello__greet')).toEqual({ source: 'plugin:hello', label: f, tool: 'greet' })
    host.stop()
  }, 20000)

  it('a modified plugin file needs a new confirmation', async () => {
    const { dir, trust, host, tm } = setup()
    const f = path.join(dir, 'hello.js'); fs.writeFileSync(f, HELLO)
    trust.update(t => { t.plugins[f] = fileSha256(f) })
    fs.appendFileSync(f, '\n// changed')
    await tm.loadPlugins()
    expect(tm.pending[0]).toMatchObject({ path: f, changed: true })
    expect(tm.listTools().map(t => t.name)).not.toContain('hello__greet')
    host.stop()
  }, 20000)

  it('a crashing or hanging plugin does not affect the app; the host restarts', async () => {
    const { dir, trust, host, tm } = setup(1500)
    const f = path.join(dir, 'hello.js'); fs.writeFileSync(f, HELLO)
    trust.update(t => { t.plugins[f] = fileSha256(f) }); await tm.loadPlugins()
    const pid1 = host.pid
    expect(await tm.callTool('hello__crash', {})).toMatch(/Tool error: plugin host exited/)
    expect(await tm.callTool('hello__greet', { who: 'again' })).toMatch(/^hi again/)
    expect(host.pid).not.toBe(pid1)
    expect(await tm.callTool('hello__hang', {})).toMatch(/timed out/)
    expect(await tm.callTool('hello__greet', { who: 'after hang' })).toMatch(/^hi after hang/)
    expect(host.restarts).toBeGreaterThanOrEqual(2)
    host.stop()
  }, 20000)

  it('stdio MCP servers only start after the exact command was approved', async () => {
    const { trust, tm } = setup()
    const cfg = { id: 'e', name: 'echo', type: 'stdio' as const, command: process.execPath, args: [path.resolve('tests/fixtures-mcp-server.mjs')], enabled: true }
    await tm.syncMcp([cfg])
    expect(tm.status().mcp[0].status).toBe('needs-approval')
    trust.update(t => { t.mcp.e = mcpCommandHash(cfg) })
    await tm.syncMcp([cfg])
    expect(tm.status().mcp[0].status).toBe('connected')
    expect(await tm.callTool('mcp_echo__echo', { text: '你好' })).toBe('echo: 你好')
    expect(tm.resolve('mcp_echo__echo')).toMatchObject({ source: 'mcp:e', tool: 'echo' })
    // changed args -> approval no longer matches
    await tm.syncMcp([{ ...cfg, args: [...cfg.args, '--extra'] }])
    expect(tm.status().mcp[0].status).toBe('needs-approval')
    await tm.syncMcp([])
  }, 20000)
})

describe('trust store', () => {
  it('grants are scoped per source + tool; legacy unscoped allowlist is dropped', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-'))
    fs.writeFileSync(path.join(root, 'tool-allowlist.json'), JSON.stringify(['builtin__get_current_time']))
    fs.writeFileSync(path.join(root, 'trust.json'), JSON.stringify({ grants: ['plugin:builtin::calculator', 'calculator', 'mcp:a::echo'] }))
    const t = new TrustStore(path.join(root, 'trust.json'), path.join(root, 'tool-allowlist.json'))
    expect(t.read().grants).toEqual(['plugin:builtin::calculator', 'mcp:a::echo'])
    expect(fs.existsSync(path.join(root, 'tool-allowlist.json'))).toBe(false)
    expect(grantKey('mcp:a', 'echo')).toBe('mcp:a::echo'); expect(isScopedGrant('echo')).toBe(false)
    expect(mcpCommandHash({ command: 'npx', args: ['a'] })).not.toBe(mcpCommandHash({ command: 'npx', args: ['a', 'b'] }))
    expect(commandLine({ command: 'npx', args: ['-y', 'pkg', 'C:\\My Files', 'a"b'] })).toBe('npx -y pkg "C:\\\\My Files" "a\\"b"')
  })
})
