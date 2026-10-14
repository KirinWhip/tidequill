// Round 2 stage D: developer mode, plugin host process + first-load confirmation, MCP stdio command confirmation,
// scoped grants page, atomic writes + rotating backups + automatic restore of a corrupted data file
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { launch, seedUserData, send } from './helpers'
// @ts-ignore
import { startMockServer } from '../tests/mock-server.mjs'
import { zhCN } from '../src/renderer/locales/zh-CN'
import { en } from '../src/renderer/locales/en'

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'r2-D')
fs.mkdirSync(SHOTS, { recursive: true })
let mock: any
test.beforeAll(async () => { mock = await startMockServer(0) })
test.afterAll(async () => { await mock.close() })
let app: ElectronApplication, page: Page
test.afterEach(async ({}, info) => {
  if (page && info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  await app?.close().catch(() => {})
})
const shot = (n: string) => page.screenshot({ path: path.join(SHOTS, n + '.png') })
const openTools = () => page.getByTestId('nav-tools').locator('button').nth(3).click()
const PLUGIN = `module.exports = { name: 'hello', description: 'E2E plugin', tools: [{ name: 'greet', description: 'greet someone', parameters: { type: 'object', properties: { who: { type: 'string' } } }, execute: (a) => 'hi ' + a.who + ' pid=' + process.pid }] }\n`
const MCP_FIXTURE = path.resolve(__dirname, '..', 'tests', 'fixtures-mcp-server.mjs')
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const devtoolsOpen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened())
const withPlugin = (ud: string) => { fs.mkdirSync(path.join(ud, 'plugins'), { recursive: true }); const f = path.join(ud, 'plugins', 'hello.js'); fs.writeFileSync(f, PLUGIN); return f }
const trusted = (ud: string, extra: any = {}) => { const f = withPlugin(ud); fs.writeFileSync(path.join(ud, 'trust.json'), JSON.stringify({ plugins: { [f]: sha(PLUGIN) }, mcp: {}, grants: [], ...extra })); return f }

for (const [lang, theme] of [['zh', 'light'], ['zh', 'dark'], ['en', 'light'], ['en', 'dark']] as const) {
  test(`overview ${theme}-${lang}`, async () => {
    const ud = seedUserData({ mockUrl: mock.url, language: lang, theme, settings: { mcpServers: [{ id: 'echo1', name: 'echo', type: 'stdio', command: 'node', args: [MCP_FIXTURE], enabled: false }] } })
    trusted(ud, { mcp: { echo1: 'x' }, grants: ['plugin:hello::greet', 'plugin:builtin::get_current_time'] })
    ;({ app, page } = await launch(ud))
    await openTools()
    await expect(page.getByTestId('grant-row')).toHaveCount(2)
    await page.getByTestId('grants').scrollIntoViewIfNeeded()
    await shot(`${theme}-${lang}`)
  })
}

test('developer mode: F12 / DevTools blocked in the packaged app by default, allowed once developer mode is on', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url })))
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  await page.keyboard.press('F12'); await page.waitForTimeout(800)
  expect(await devtoolsOpen()).toBe(false)
  // also a programmatic open is closed again immediately
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.openDevTools({ mode: 'detach' }))
  await expect.poll(devtoolsOpen, { timeout: 5000 }).toBe(false)
  await page.keyboard.press('Control+,'); await page.locator('.tabs button[data-tab="general"]').click()
  const cb = page.getByTestId('dev-mode')
  await expect(cb).not.toBeChecked()
  await cb.check()
  await cb.scrollIntoViewIfNeeded(); await shot('developer-mode-setting')
  await page.locator('.tabs button[data-tab="shortcuts"]').click()
  await expect(page.locator('table.sc')).toContainText(zhCN.key_f12)
  await page.keyboard.press('Escape')
  await page.keyboard.press('F12')
  await expect.poll(devtoolsOpen, { timeout: 10_000 }).toBe(true)
  // persisted and applied at the next start
  const s = JSON.parse(fs.readFileSync(path.join(await app.evaluate(({ app }) => app.getPath('userData')), 'data', 'settings.json'), 'utf8'))
  expect(s.devMode).toBe(true)
})

test('plugins: first load shows path + SHA-256 and waits; trusted plugin runs in a separate utility process', async () => {
  const ud = seedUserData({ mockUrl: mock.url, model: 'mock-tool-plugin' })
  const f = withPlugin(ud)
  ;({ app, page } = await launch(ud))
  const modal = page.getByTestId('plugin-trust')
  await expect(modal).toBeVisible()
  await expect(page.getByTestId('plugin-trust-path')).toHaveText(f)
  await expect(page.getByTestId('plugin-trust-sha')).toHaveText(sha(PLUGIN))
  // not loaded before confirmation
  expect((await page.evaluate(() => (window as any).api.listTools())).map((t: any) => t.name)).not.toContain('hello__greet')
  await shot('plugin-first-load-confirm')
  await page.getByTestId('plugin-trust-allow').click()
  await expect(modal).toHaveCount(0)
  expect(JSON.parse(fs.readFileSync(path.join(ud, 'trust.json'), 'utf8')).plugins).toEqual({ [f]: sha(PLUGIN) })
  await expect.poll(async () => (await page.evaluate(() => (window as any).api.listTools())).map((t: any) => t.name)).toContain('hello__greet')
  await app.evaluate(({ dialog }) => { (dialog as any).showMessageBox = async (_w: any, o: any) => { (globalThis as any).__box = o; return { response: 0, checkboxChecked: true } } })
  await page.getByRole('button', { name: zhCN.newChat }).first().click()
  await send(page, '打个招呼')
  await expect(page.locator('.msg.assistant .bubble').last()).toContainText('TOOL_RESULT: hi e2e pid=', { timeout: 15_000 })
  const text = await page.locator('.msg.assistant .bubble').last().innerText()
  const pid = Number(/pid=(\d+)/.exec(text)![1])
  const procs = await app.evaluate(({ app }) => ({ main: process.pid, metrics: app.getAppMetrics().map(m => ({ pid: m.pid, type: m.type, name: (m as any).name, serviceName: (m as any).serviceName })) }))
  expect(pid).not.toBe(procs.main)
  expect(procs.metrics.find(m => m.pid === pid)?.type).toBe('Utility')
  // the dialog names the source; the grant is scoped to plugin:hello::greet
  const box = await app.evaluate(() => (globalThis as any).__box)
  expect(box.detail).toContain(f)
  expect(JSON.parse(fs.readFileSync(path.join(ud, 'trust.json'), 'utf8')).grants).toEqual(['plugin:hello::greet'])
})

test('plugins: a modified file must be confirmed again and is not loaded meanwhile', async () => {
  const ud = seedUserData({ mockUrl: mock.url })
  const f = trusted(ud); fs.appendFileSync(f, '// tampered\n')
  ;({ app, page } = await launch(ud))
  await expect(page.getByTestId('plugin-trust')).toBeVisible()
  await expect(page.getByTestId('plugin-changed')).toBeVisible()
  expect((await page.evaluate(() => (window as any).api.listTools())).map((t: any) => t.name)).not.toContain('hello__greet')
  await page.getByTestId('plugin-trust-deny').click()
  await expect(page.getByTestId('plugin-trust')).toHaveCount(0)
})

test('MCP stdio: adding a server shows the full command line + args; nothing starts before confirmation', async () => {
  const ud = seedUserData({ mockUrl: mock.url, settings: { mcpServers: [{ id: 'pre', name: 'preset', type: 'stdio', command: 'node', args: [MCP_FIXTURE], enabled: true }] } })
  ;({ app, page } = await launch(ud))
  await openTools()
  // an enabled stdio server that was never confirmed (e.g. imported settings) is not started
  await expect(page.getByTestId('mcp-needs-approval')).toBeVisible()
  await page.getByTestId('mcp-add').click()
  // screenshot with the default (filesystem server) draft, so no machine-specific path ends up in the image
  await page.getByTestId('mcp-add-args').fill('-y @modelcontextprotocol/server-filesystem ~/Documents')
  await page.getByTestId('mcp-add-save').click()
  await expect(page.getByTestId('mcp-confirm-cmd')).toHaveText('npx -y @modelcontextprotocol/server-filesystem ~/Documents')
  await shot('mcp-add-server-confirm')
  await page.getByTestId('mcp-confirm-cancel').click()
  await page.getByTestId('mcp-add-name').fill('echo')
  await page.getByTestId('mcp-add-command').fill('node')
  await page.getByTestId('mcp-add-args').fill(`${MCP_FIXTURE} --flag`)
  await page.getByTestId('mcp-add-save').click()
  const m = page.getByTestId('mcp-confirm')
  await expect(m).toBeVisible()
  await expect(page.getByTestId('mcp-confirm-cmd')).toHaveText(`node ${MCP_FIXTURE} --flag`)
  await expect(page.getByTestId('mcp-confirm-args').locator('li')).toHaveText([MCP_FIXTURE, '--flag'])
  // cancel: server not added
  await page.getByTestId('mcp-confirm-cancel').click()
  await expect(page.getByTestId('mcp-card')).toHaveCount(1)
  await page.getByTestId('mcp-add-save').click()
  await page.getByTestId('mcp-confirm-ok').click()
  await expect(page.getByTestId('mcp-card')).toHaveCount(2)
  await expect(page.getByTestId('mcp-card').nth(1)).toContainText('connected', { timeout: 15_000 })
  await expect(page.getByTestId('mcp-card').nth(1)).toContainText('echo')
  // preset can be reviewed and approved from its card
  await page.getByTestId('mcp-review').click()
  await expect(page.getByTestId('mcp-confirm-cmd')).toHaveText(`node ${MCP_FIXTURE}`)
  await page.getByTestId('mcp-confirm-ok').click()
  await expect(page.getByTestId('mcp-card').first()).toContainText('connected', { timeout: 15_000 })
  expect(Object.keys(JSON.parse(fs.readFileSync(path.join(ud, 'trust.json'), 'utf8')).mcp).sort()).toHaveLength(2)
  // editing the args invalidates the approval
  await page.getByTestId('mcp-card').first().locator('input').nth(2).fill(`${MCP_FIXTURE} --changed`)
  await expect(page.getByTestId('mcp-needs-approval')).toBeVisible({ timeout: 10_000 })
})

test('grants page: scoped always-allow grants, trusted plugins and MCP commands; revoke one / revoke all', async () => {
  const ud = seedUserData({ mockUrl: mock.url, model: 'mock-tool' })
  trusted(ud, { mcp: { gone: 'x' }, grants: ['plugin:hello::greet', 'mcp:gone::echo'] })
  ;({ app, page } = await launch(ud))
  await app.evaluate(({ dialog }) => { (dialog as any).showMessageBox = async () => ({ response: 0, checkboxChecked: true }) })
  await page.getByRole('button', { name: zhCN.newChat }).first().click()
  await send(page, '现在几点')
  await expect(page.locator('.msg.assistant .bubble').last()).toContainText('TOOL_RESULT:', { timeout: 15_000 })
  await openTools()
  await expect(page.getByTestId('grant-row')).toHaveCount(3)
  await expect(page.getByTestId('trusted-plugin')).toHaveCount(1)
  await expect(page.getByTestId('trusted-mcp')).toHaveCount(1)
  await page.getByTestId('grants').scrollIntoViewIfNeeded()
  await shot('grants-page')
  await page.getByTestId('grant-row').filter({ hasText: 'greet' }).getByTestId('grant-revoke').click()
  await expect(page.getByTestId('grant-row')).toHaveCount(2)
  const t1 = JSON.parse(fs.readFileSync(path.join(ud, 'trust.json'), 'utf8'))
  expect(t1.grants).toEqual(['mcp:gone::echo', 'plugin:builtin::get_current_time'])
  await page.getByTestId('revoke-all').click()
  await expect(page.getByTestId('grant-row')).toHaveCount(0)
  await expect(page.getByTestId('trusted-plugin')).toHaveCount(0)
  expect(JSON.parse(fs.readFileSync(path.join(ud, 'trust.json'), 'utf8'))).toEqual({ plugins: {}, mcp: {}, grants: [] })
  // plugin is unloaded after its trust was revoked
  await expect.poll(async () => (await page.evaluate(() => (window as any).api.listTools())).map((t: any) => t.name)).not.toContain('hello__greet')
})

test('storage: corrupted conversations.json is restored from the newest backup on the next start', async () => {
  const now = Date.now()
  const conv = { id: 'keep', title: '备份里的对话', pinned: false, providerId: 'mock', model: 'mock-ok', systemPrompt: '', createdAt: now, updatedAt: now, messages: [{ id: 'm', role: 'user', content: '不要丢', createdAt: now }] }
  const ud = seedUserData({ mockUrl: mock.url, conversations: [conv] })
  ;({ app, page } = await launch(ud))
  await expect(page.locator('.conv')).toHaveCount(1)
  await app.close()
  const bdir = path.join(ud, 'backups', 'conversations')
  expect(fs.readdirSync(bdir).length).toBeGreaterThanOrEqual(1)
  // simulate a torn write / disk error
  const file = path.join(ud, 'data', 'conversations.json')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(0, 40))
  ;({ app, page } = await launch(ud))
  await expect(page.getByTestId('storage-notice')).toBeVisible()
  await expect(page.getByTestId('storage-notice')).toContainText('conversations')
  await expect(page.locator('.conv')).toHaveCount(1)
  await expect(page.locator('.conv').first()).toContainText('备份里的对话')
  await shot('backup-restore-notice')
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))[0].id).toBe('keep')
  const corrupt = fs.readdirSync(path.join(ud, 'data')).filter(f => f.startsWith('conversations.corrupt-'))
  expect(corrupt).toHaveLength(1)
  await page.getByTestId('storage-notice-dismiss').click()
  await expect(page.getByTestId('storage-notice')).toHaveCount(0)
})

test('english strings for stage D controls', async () => {
  expect(en.devMode).toBe('Developer mode'); expect(en.trustLoad).toBe('Trust and load'); expect(en.revokeAll).toBe('Revoke all')
  expect(en.storageRestored).toContain('{backup}'); expect(zhCN.storageRestored).toContain('{file}')
})
