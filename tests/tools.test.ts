import { describe, it, expect } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { ToolManager } from '../electron/tools'

describe('ToolManager', () => {
  it('loads builtin + user plugin and calls them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plug-'))
    fs.writeFileSync(path.join(dir, 'hello.js'), `module.exports = { name: 'hello', tools: [{ name: 'greet', description: 'greet', parameters: { type: 'object', properties: {} }, execute: (a) => 'hi ' + a.who }] }`)
    const tm = new ToolManager(dir); tm.loadPlugins()
    const names = tm.listTools().map(t => t.name)
    expect(names).toContain('builtin__calculator'); expect(names).toContain('hello__greet')
    expect(await tm.callTool('builtin__calculator', { expression: '2*(3+4)' })).toBe('14')
    expect(await tm.callTool('hello__greet', { who: 'bob' })).toBe('hi bob')
  })
  it('connects to a stdio MCP server', async () => {
    const tm = new ToolManager(fs.mkdtempSync(path.join(os.tmpdir(), 'plug-')))
    await tm.syncMcp([{ id: 'e', name: 'echo', type: 'stdio', command: process.execPath, args: [path.resolve('tests/fixtures-mcp-server.mjs')], enabled: true }])
    expect(tm.status().mcp[0].status).toBe('connected')
    expect(await tm.callTool('mcp_echo__echo', { text: '你好' })).toBe('echo: 你好')
    await tm.syncMcp([])
  }, 20000)
})
