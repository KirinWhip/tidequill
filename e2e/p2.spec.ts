import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, seedUserData, send } from './helpers'
// @ts-ignore
import { startMockServer, REPLY, USAGE, UPDATE_VERSION } from '../tests/mock-server.mjs'
import { zhCN } from '../src/renderer/locales/zh-CN'
import { en } from '../src/renderer/locales/en'
import { formatCost } from '../src/shared/usage'
// @ts-ignore
import { v2 as webdav } from 'webdav-server'

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'p2')
fs.mkdirSync(SHOTS, { recursive: true })
let mock: any
test.beforeAll(async () => { mock = await startMockServer() })
test.afterAll(async () => { await mock.close() })

let app: ElectronApplication, page: Page, ud: string
type Seed = Partial<Parameters<typeof seedUserData>[0]>
async function start(seed: Seed = {}, env: Record<string, string> = {}) {
  ud = seedUserData({ mockUrl: mock.url, ...seed })
  ;({ app, page } = await launch(ud, env))
}
test.afterEach(async ({}, info) => {
  if (page && info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  await app?.close().catch(() => {})
})
const reply = REPLY.join('').trim()
const lastBubble = () => page.locator('.msg.assistant .bubble').last()
async function newChatAndSend(text: string, t = zhCN) {
  await page.getByRole('button', { name: new RegExp(t.newChat) }).first().click()
  await send(page, text)
}
const stubSave = (p: string) => app.evaluate(({ dialog }, p) => { (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: p }) }, p)
const stubOpen = (p: string) => app.evaluate(({ dialog }, p) => { (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, p)
const tmp = (name: string) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p2-')), name)
const now = Date.now()
const M = (id: string, role: string, content: string, extra: any = {}) => ({ id, role, content, createdAt: now, ...(role === 'assistant' ? { model: 'mock-ok' } : {}), ...extra })
const C = (id: string, title: string, messages: any[], extra: any = {}) => ({ id, title, pinned: false, providerId: 'mock', model: 'mock-ok', systemPrompt: '', createdAt: now, updatedAt: now - id.length, messages, ...extra })
async function openSettingsTab(tab: string, t = zhCN) {
  await page.locator('.sidenav button', { hasText: t.settings }).click()
  await page.locator(`.tabs button[data-tab="${tab}"]`).click()
}

test('per-conversation settings: system prompt, temperature, top_p, max tokens, context count are sent', async () => {
  await start()
  await newChatAndSend('第一条')
  await expect(lastBubble()).toContainText(reply, { timeout: 10_000 })
  await page.getByRole('button', { name: zhCN.convSettings, exact: true }).click()
  const dlg = page.getByRole('dialog', { name: zhCN.convSettings })
  await dlg.getByTestId('conv-system').fill('你是海盗')
  await dlg.locator('[data-param="temperature"]').fill('0.3')
  await dlg.locator('[data-param="topP"]').fill('0.5')
  await dlg.locator('[data-param="maxTokens"]').fill('77')
  await dlg.locator('[data-param="contextLength"]').fill('1')
  await page.screenshot({ path: path.join(SHOTS, 'conversation-settings.png') })
  await dlg.getByRole('button', { name: zhCN.save, exact: true }).click()
  await send(page, '第二条')
  await expect(page.locator('.msg.assistant')).toHaveCount(2)
  await expect(lastBubble()).toContainText(reply, { timeout: 10_000 })
  const r = mock.requests.at(-1)
  expect(r.temperature).toBe(0.3); expect(r.top_p).toBe(0.5); expect(r.max_tokens).toBe(77)
  expect(r.messages[0]).toEqual({ role: 'system', content: '你是海盗' })
  expect(r.messages.filter((m: any) => m.role !== 'system')).toHaveLength(1) // context count = 1
  // global defaults unaffected for a new conversation
  await newChatAndSend('新会话')
  await expect(lastBubble()).toContainText(reply, { timeout: 10_000 })
  expect(mock.requests.at(-1).temperature).toBe(0.7)
})

const errs: [string, string, string, string][] = [
  ['mock-quota', 'quota', zhCN.err_quota, en.err_quota],
  ['mock-notfound', 'not_found', zhCN.err_not_found, en.err_not_found],
  ['mock-context', 'context_too_long', zhCN.err_context_too_long, en.err_context_too_long],
]
for (const [model, code, zh, enText] of errs) test(`readable error: ${code} (zh + en)`, async () => {
  await start({ model, settings: { retries: 2 } })
  await newChatAndSend('x ' + code)
  const err = page.locator('.msg.assistant .error').last()
  await expect(err).toHaveAttribute('data-error-code', code, { timeout: 15_000 })
  await expect(err).toContainText(zh)
  expect(mock.requests.filter((r: any) => r.messages?.at(-1)?.content === 'x ' + code)).toHaveLength(1) // not retried
  if (code === 'quota') {
    await err.locator('summary').click()
    await page.screenshot({ path: path.join(SHOTS, 'error-message-zh.png') })
  }
  await openSettingsTab('general')
  await page.locator('.modal select').first().selectOption('en')
  await page.keyboard.press('Escape')
  await expect(err).toContainText(enText)
  if (code === 'context_too_long') await page.screenshot({ path: path.join(SHOTS, 'error-message-en.png') })
})

test('auto-retry with backoff: 503 twice then success, retry notice shown', async () => {
  await start({ model: 'mock-flaky', settings: { retries: 3, retryBaseMs: 700 } })
  await newChatAndSend('flaky please')
  await expect(page.getByTestId('retry-status')).toContainText(zhCN.retrying.split('（')[0], { timeout: 5000 })
  await expect(lastBubble()).toContainText(reply, { timeout: 20_000 })
  await expect(page.getByTestId('retry-status')).toHaveCount(0)
  expect(mock.requests.filter((r: any) => r.messages?.at(-1)?.content === 'flaky please')).toHaveLength(3)
})

test('retries disabled -> server error shown immediately', async () => {
  await start({ model: 'mock-flaky', settings: { retries: 0 } })
  await newChatAndSend('flaky no retry')
  await expect(page.locator('.msg.assistant .error').last()).toHaveAttribute('data-error-code', 'server', { timeout: 10_000 })
})

test('token usage and cost per message and per conversation; toggle off', async () => {
  await start({ settings: { prices: [{ pattern: 'mock', input: 100, output: 200 }] } })
  await newChatAndSend('算一下费用')
  await expect(lastBubble()).toContainText(reply, { timeout: 10_000 })
  const u = page.getByTestId('msg-usage').last()
  await expect(u).toContainText(`${USAGE.prompt_tokens}`); await expect(u).toContainText(`${USAGE.completion_tokens}`)
  const cost = (USAGE.prompt_tokens * 100 + USAGE.completion_tokens * 200) / 1e6
  await expect(u).toContainText(`$${cost.toFixed(4)}`)
  await send(page, '再来一次')
  await expect(page.getByTestId('msg-usage')).toHaveCount(2, { timeout: 10_000 })
  await expect(page.getByTestId('conv-usage')).toContainText(String(2 * (USAGE.prompt_tokens + USAGE.completion_tokens)))
  await expect(page.getByTestId('conv-usage')).toContainText(formatCost(2 * cost))
  await page.locator('.msg.assistant').last().hover()
  await page.screenshot({ path: path.join(SHOTS, 'token-cost.png') })
  // price table editable in settings
  await openSettingsTab('usageSettings')
  await page.getByLabel(zhCN.priceInput).first().fill('1000')
  await page.getByLabel(zhCN.showUsage).uncheck()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('msg-usage')).toHaveCount(0)
  await expect(page.getByTestId('conv-usage')).toHaveCount(0)
})

test('usage estimated when provider returns none (Ollama-style), marked as estimate', async () => {
  await start({ model: 'mock-disconnect' })
  await newChatAndSend('估算')
  await expect(page.locator('.msg.assistant .error')).toBeVisible({ timeout: 10_000 })
  // errors carry no usage; now a normal reply through provider type ollama (no include_usage)
  await app.close()
  const base = mock.url.replace(/\/v1$/, '')
  await start({ settings: { providers: [{ id: 'ol', name: 'Ollama', type: 'ollama', apiKey: '', baseURL: base, models: ['mock-ok'] }], defaultProviderId: 'ol', onboarded: true } })
  await newChatAndSend('估算')
  await expect(lastBubble()).toContainText(reply, { timeout: 10_000 })
  await expect(page.getByTestId('msg-usage').last()).toContainText(zhCN.estimated)
})

test('chat ops: regenerate creates branches with navigation, edit & resend branches, delete, stop', async () => {
  await start()
  await newChatAndSend('问题一')
  await expect(lastBubble()).toContainText(reply, { timeout: 10_000 })
  const asst = page.locator('.msg.assistant').last()
  await asst.hover()
  await asst.getByRole('button', { name: zhCN.regenerate, exact: true }).click()
  await expect(page.getByTestId('branch-nav')).toContainText('2/2', { timeout: 10_000 })
  await expect(lastBubble()).toContainText(reply, { timeout: 10_000 })
  await page.locator('.msg.assistant').last().hover()
  await page.getByRole('button', { name: zhCN.prevBranch }).click()
  await expect(page.getByTestId('branch-nav')).toContainText('1/2')
  await page.getByRole('button', { name: zhCN.nextBranch }).click()
  await expect(page.getByTestId('branch-nav')).toContainText('2/2')
  // edit & resend the user message -> new branch at position 0
  const user = page.locator('.msg.user').first()
  await user.hover()
  await user.getByRole('button', { name: zhCN.edit, exact: true }).click()
  await page.locator('.editbox textarea').fill('问题一（修改）')
  await page.getByRole('button', { name: zhCN.saveSend }).click()
  await expect(lastBubble()).toContainText(reply, { timeout: 10_000 })
  await expect(page.locator('.msg.user .usertext')).toHaveText(['问题一（修改）'])
  const nav0 = page.locator('.msg.user').first().getByTestId('branch-nav')
  await expect(nav0).toContainText('2/2')
  await page.locator('.msg.user').first().hover()
  await nav0.getByRole('button', { name: zhCN.prevBranch }).click()
  await expect(page.locator('.msg.user .usertext')).toHaveText(['问题一'])
  await expect(page.locator('.msg.assistant').last().getByTestId('branch-nav')).toContainText('2/2') // nested branch preserved
  // delete a message
  await page.locator('.msg.assistant').last().hover()
  await page.locator('.msg.assistant').last().getByRole('button', { name: zhCN.delete, exact: true }).click()
  await expect(page.locator('.msg.assistant')).toHaveCount(0)
})

test('fork into a new conversation and quote reply', async () => {
  await start()
  await newChatAndSend('原始问题')
  await expect(lastBubble()).toContainText(reply, { timeout: 10_000 })
  const asst = page.locator('.msg.assistant').last()
  await asst.hover()
  await asst.getByRole('button', { name: zhCN.quoteReply }).click()
  await expect(page.locator('.quotebar')).toContainText(REPLY[0])
  await send(page, '针对引用的追问')
  await expect(page.locator('.msg.user').last().locator('.msgquote')).toContainText(REPLY[0])
  await expect(page.locator('.msg.assistant')).toHaveCount(2)
  await expect(lastBubble()).toContainText(reply, { timeout: 10_000 })
  const userMsg = mock.requests.at(-1).messages.at(-1)
  expect(String(userMsg.content)).toMatch(/^> 你好！/); expect(String(userMsg.content)).toContain('针对引用的追问')
  // fork from first assistant reply
  await page.locator('.msg.assistant').first().hover()
  await page.locator('.msg.assistant').first().getByRole('button', { name: zhCN.forkConv }).click()
  await expect(page.locator('.conv')).toHaveCount(2)
  await expect(page.locator('.msg')).toHaveCount(2)
  await expect(page.locator('.convbar')).toContainText(zhCN.forkedFrom)
  await page.locator('.convbar .linkbtn').click()
  await expect(page.locator('.msg')).toHaveCount(4)
})

const libConvs = () => [
  C('a1', '旅行计划：京都', [M('m1', 'user', '帮我规划京都三日游，包括伏见稻荷'), M('m2', 'assistant', '第一天：伏见稻荷大社……')], { tags: ['旅行'] }),
  C('a22', '周报润色', [M('m3', 'user', '润色这段周报')], { tags: ['工作'] }),
  C('a333', 'SQL 优化', [M('m4', 'user', '这条 SQL 很慢：SELECT * FROM orders')], { tags: ['工作', '数据库'] }),
  C('a4444', '学习 Rust', [M('m5', 'user', '所有权是什么')]),
]

test('folders, context menu, tags filter, rename, pin, content search with snippet, multi-select batch delete', async () => {
  await start({ conversations: libConvs() })
  // new folder
  await page.getByRole('button', { name: zhCN.newFolder }).click()
  const fin = page.locator('.folderhead input')
  await fin.fill('工作项目'); await fin.press('Enter')
  await expect(page.locator('.folderhead .title')).toContainText(['工作项目'])
  // context menu -> move to folder
  await page.locator('.conv', { hasText: '周报润色' }).click({ button: 'right' })
  await expect(page.getByRole('menu')).toBeVisible()
  await page.getByRole('menuitem', { name: '工作项目' }).click()
  await page.locator('.conv', { hasText: 'SQL 优化' }).click({ button: 'right' })
  await page.screenshot({ path: path.join(SHOTS, 'context-menu-folders.png') })
  await page.getByRole('menuitem', { name: '工作项目' }).click()
  await expect(page.locator('.conv.indent')).toHaveCount(2)
  // pin + rename via context menu
  await page.locator('.conv', { hasText: '学习 Rust' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: zhCN.pin }).click()
  await expect(page.locator('.conv', { hasText: '学习 Rust' }).locator('.pinmark')).toBeVisible()
  await page.locator('.conv', { hasText: '学习 Rust' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: zhCN.rename }).click()
  const rin = page.locator('.conv input'); await rin.fill('Rust 所有权'); await rin.press('Enter')
  await expect(page.locator('.conv .title', { hasText: 'Rust 所有权' })).toBeVisible()
  // collapse folder
  await page.locator('.folderhead', { hasText: '工作项目' }).click()
  await expect(page.locator('.conv.indent')).toHaveCount(0)
  await page.locator('.folderhead', { hasText: '工作项目' }).click()
  // tags filter
  await page.locator('.tagchip', { hasText: '数据库' }).click()
  await expect(page.locator('.conv')).toHaveCount(1)
  await page.locator('.tagchip', { hasText: zhCN.allTags }).click()
  // global search in content with snippet
  await page.getByPlaceholder(zhCN.search).fill('伏见稻荷')
  await expect(page.locator('.conv')).toHaveCount(1)
  await expect(page.locator('.conv .snippet')).toContainText('伏见稻荷')
  await page.screenshot({ path: path.join(SHOTS, 'search-snippet.png') })
  await page.getByPlaceholder(zhCN.search).fill('')
  // multi-select batch delete
  await page.getByRole('button', { name: zhCN.select, exact: true }).click()
  await page.locator('.conv', { hasText: '周报润色' }).click()
  await page.locator('.conv', { hasText: 'SQL 优化' }).click()
  await expect(page.locator('.listhead')).toContainText('2')
  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: new RegExp(zhCN.deleteSelected) }).click()
  await expect(page.locator('.conv')).toHaveCount(2)
  // persisted
  await page.waitForTimeout(800)
  const saved = JSON.parse(fs.readFileSync(path.join(ud, 'data', 'conversations.json'), 'utf8'))
  expect(saved.map((c: any) => c.title).sort()).toEqual(['Rust 所有权', '旅行计划：京都'].sort())
  expect(JSON.parse(fs.readFileSync(path.join(ud, 'data', 'folders.json'), 'utf8'))[0].name).toBe('工作项目')
})

test('tags edited in conversation settings', async () => {
  await start({ conversations: libConvs() })
  await page.locator('.conv', { hasText: '学习 Rust' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: zhCN.editTags }).click()
  await page.getByTestId('conv-tags').fill('学习, 编程')
  await page.getByRole('dialog').getByRole('button', { name: zhCN.save, exact: true }).click()
  await page.locator('.tagchip', { hasText: '编程' }).click()
  await expect(page.locator('.conv')).toHaveCount(1)
  await expect(page.locator('.conv')).toContainText('学习 Rust')
})

test('Ollama: detect local server and list installed models', async () => {
  const base = mock.url.replace(/\/v1$/, '')
  await start({ settings: { providers: [{ id: 'mock', name: 'Mock', type: 'openai', apiKey: 'k', baseURL: mock.url, models: ['mock-ok'] }, { id: 'ollama', name: 'Ollama', type: 'ollama', apiKey: '', baseURL: base, models: [] }] } })
  await openSettingsTab('providers')
  await page.getByTestId('ollama-detect').click()
  await expect(page.getByTestId('settings-msg')).toContainText(zhCN.ollamaFound + '3')
  await page.locator('.pitem', { hasText: 'Ollama' }).click()
  await expect(page.locator('.form textarea').first()).toHaveValue(/llama3\.2:latest/)
  // not found case
  await app.close()
  await start({ settings: { providers: [{ id: 'mock', name: 'Mock', type: 'openai', apiKey: 'k', baseURL: mock.url, models: ['mock-ok'] }, { id: 'ollama', name: 'Ollama', type: 'ollama', apiKey: '', baseURL: 'http://127.0.0.1:9', models: [] }] } })
  await openSettingsTab('providers')
  await page.getByTestId('ollama-detect').click()
  await expect(page.getByTestId('settings-msg')).toContainText('127.0.0.1:9')
})

test('backup (keys scrubbed) and restore full archive', async () => {
  await start({ conversations: libConvs() })
  const out = tmp('backup.json')
  await stubSave(out)
  await openSettingsTab('data')
  await page.getByTestId('backup').click()
  await expect.poll(() => fs.existsSync(out)).toBe(true)
  const b = JSON.parse(fs.readFileSync(out, 'utf8'))
  expect(b.format).toBe('tidequill-backup'); expect(b.data.conversations).toHaveLength(4)
  expect(fs.readFileSync(out, 'utf8')).not.toContain('sk-plaintext-e2e')
  await page.keyboard.press('Escape')
  // wipe conversations, then restore
  await page.getByRole('button', { name: zhCN.select, exact: true }).click()
  for (const c of await page.locator('.conv').all()) await c.click()
  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: new RegExp(zhCN.deleteSelected) }).click()
  await expect(page.locator('.conv')).toHaveCount(0)
  await stubOpen(out)
  await openSettingsTab('data')
  page.once('dialog', d => d.accept())
  await page.getByTestId('restore').click()
  await expect(page.locator('.conv')).toHaveCount(4, { timeout: 10_000 })
  // API key kept (backup had none)
  const raw = fs.readFileSync(path.join(ud, 'data', 'settings.json'), 'utf8')
  expect(JSON.parse(raw).providers[0].apiKey).not.toBe('')
})

test('export conversation as PDF (printToPDF) and JSON', async () => {
  await start({ conversations: libConvs() })
  await page.locator('.conv', { hasText: '旅行计划' }).click()
  const pdf = tmp('conv.pdf')
  await stubSave(pdf)
  await page.getByRole('button', { name: zhCN.exportAs, exact: true }).click()
  await page.getByRole('menuitem', { name: zhCN.exportPdf }).click()
  await expect.poll(() => fs.existsSync(pdf) && fs.statSync(pdf).size > 1000, { timeout: 15_000 }).toBe(true)
  expect(fs.readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-')
  const js = tmp('conv.json'); await stubSave(js)
  await page.getByRole('button', { name: zhCN.exportAs, exact: true }).click()
  await page.getByRole('menuitem', { name: zhCN.exportJsonConv }).click()
  await expect.poll(() => fs.existsSync(js)).toBe(true)
  expect(JSON.parse(fs.readFileSync(js, 'utf8')).conversations[0].title).toBe('旅行计划：京都')
})

test('WebDAV sync between two installs via local WebDAV server', async () => {
  const um = new webdav.SimpleUserManager(); const user = um.addUser('dav', 'davpass', false)
  const pm = new webdav.SimplePathPrivilegeManager(); pm.setRights(user, '/', ['all'])
  const server = new webdav.WebDAVServer({ port: 0, hostname: '127.0.0.1', httpAuthentication: new webdav.HTTPBasicAuthentication(um, 'e2e'), privilegeManager: pm })
  const port: number = await new Promise(r => server.start((s: any) => r(s.address().port)))
  try {
    const wd = (password: string) => ({ webdav: { enabled: true, url: `http://127.0.0.1:${port}/tidequill/`, username: 'dav', password } })
    // wrong password -> auth error
    await start({ settings: wd('wrong'), conversations: [libConvs()[0]] })
    await openSettingsTab('data')
    await page.getByTestId('webdav-test').click()
    await expect(page.getByTestId('settings-msg')).toContainText(zhCN.err_auth)
    await app.close()
    // device A
    await start({ settings: wd('davpass'), conversations: [libConvs()[0], libConvs()[1]] })
    await openSettingsTab('data')
    await page.getByTestId('webdav-test').click()
    await expect(page.getByTestId('settings-msg')).toContainText(zhCN.webdavOk)
    await page.getByTestId('webdav-sync').click()
    await expect(page.getByTestId('settings-msg')).toContainText(zhCN.webdavSynced + '2')
    // password stored encrypted at rest
    if (process.env.EXPECT_SAFE_STORAGE || process.platform === 'win32') expect(fs.readFileSync(path.join(ud, 'data', 'settings.json'), 'utf8')).not.toContain('davpass')
    await app.close()
    // device B with a different conversation
    await start({ settings: wd('davpass'), conversations: [libConvs()[3]] })
    await openSettingsTab('data')
    await page.getByTestId('webdav-sync').click()
    await expect(page.getByTestId('settings-msg')).toContainText(zhCN.webdavSynced + '3')
    await page.keyboard.press('Escape')
    await expect(page.locator('.conv')).toHaveCount(3)
    // delete one on B, sync, and the deletion propagates through the server file
    page.once('dialog', d => d.accept())
    await page.locator('.conv', { hasText: '周报润色' }).hover()
    await page.locator('.conv', { hasText: '周报润色' }).getByRole('button', { name: zhCN.delete }).click()
    await openSettingsTab('data')
    await page.getByTestId('webdav-sync').click()
    await expect(page.getByTestId('settings-msg')).toContainText(zhCN.webdavSynced + '2')
    const remote = await (await fetch(`http://127.0.0.1:${port}/tidequill/tidequill-sync.json`, { headers: { Authorization: 'Basic ' + Buffer.from('dav:davpass').toString('base64') } })).json()
    expect(remote.conversations.map((c: any) => c.title).sort()).toEqual(['学习 Rust', '旅行计划：京都'].sort())
    expect(Object.keys(remote.tombstones)).toContain('a22')
  } finally { await new Promise(r => server.stop(r)) }
})

test('update check against a release feed reports the new version', async () => {
  const env: Record<string, string> = { TIDEQUILL_UPDATE_URL: `http://127.0.0.1:${mock.port}/updates` }
  if (process.platform === 'linux') env.APPIMAGE = '/tmp/fake-tidequill.AppImage' // electron-updater only activates for AppImage on Linux
  await start({}, env)
  await openSettingsTab('systemTab')
  await page.getByTestId('check-update').click()
  await expect(page.getByTestId('settings-msg')).toContainText(zhCN.updateAvailable + UPDATE_VERSION, { timeout: 20_000 })
})

test('system: global shortcut registered, tray keeps app alive on close, shortcuts listed', async () => {
  await start({ settings: { globalShortcut: 'CommandOrControl+Shift+F9', tray: true } })
  await expect.poll(() => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+F9'))).toBe(true)
  await openSettingsTab('systemTab')
  await expect(page.locator('.modal').getByText(zhCN.globalShortcutFail)).toHaveCount(0)
  const sc = page.locator('.modal input').first()
  await sc.fill('CommandOrControl+Shift+F8')
  await expect.poll(() => app.evaluate(({ globalShortcut }) => [globalShortcut.isRegistered('CommandOrControl+Shift+F8'), globalShortcut.isRegistered('CommandOrControl+Shift+F9')])).toEqual([true, false])
  if (process.platform === 'linux') await expect(page.getByText(zhCN.launchAtLoginUnsupported)).toBeVisible()
  await page.screenshot({ path: path.join(SHOTS, 'settings-system.png') })
  await page.locator('.tabs button[data-tab="shortcuts"]').click()
  await expect(page.locator('table.sc')).toContainText(zhCN.sc_global)
  await expect(page.locator('table.sc')).toContainText('CommandOrControl+Shift+F8')
  await page.keyboard.press('Escape')
  // closing the window hides it (tray), app keeps running
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.isVisible()))).toEqual([false])
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
})

test('first-run onboarding: pick provider, enter key, test connection', async () => {
  await start({ settings: { onboarded: false, providers: [{ id: 'mock', name: 'Mock OpenAI', type: 'openai', apiKey: '', baseURL: mock.url, models: [] }, { id: 'ol', name: 'Ollama', type: 'ollama', apiKey: '', baseURL: 'http://127.0.0.1:9', models: [] }] } })
  const dlg = page.getByRole('dialog', { name: zhCN.onbTitle })
  await expect(dlg).toBeVisible()
  await page.screenshot({ path: path.join(SHOTS, 'onboarding.png') })
  await dlg.getByTestId('onb-key').fill('sk-bad')
  await dlg.getByTestId('onb-test').click()
  await expect(dlg.getByTestId('onb-result')).toContainText(zhCN.err_auth)
  await dlg.getByTestId('onb-key').fill('sk-good')
  await dlg.getByTestId('onb-test').click()
  await expect(dlg.getByTestId('onb-result')).toContainText(zhCN.onbOk)
  await page.screenshot({ path: path.join(SHOTS, 'onboarding-ok.png') })
  await dlg.getByTestId('onb-start').click()
  await expect(dlg).toHaveCount(0)
  await newChatAndSend('开始使用')
  await expect(lastBubble()).toContainText(reply, { timeout: 10_000 })
  // not shown again after restart
  await app.close()
  ;({ app, page } = await launch(ud))
  await page.waitForTimeout(800)
  await expect(page.getByRole('dialog', { name: zhCN.onbTitle })).toHaveCount(0)
})

// ---------- screenshots ----------
const showcase = (zh: boolean) => {
  const u = { input: 1234, output: 567 }
  return [
    C('s1', zh ? '旅行计划：京都三日游' : 'Kyoto 3-day trip plan', [
      M('q1', 'user', zh ? '帮我规划京都三日游，预算 5000 元' : 'Plan a 3-day Kyoto trip on a $700 budget'),
      M('r1', 'assistant', zh ? '## 第一天\n- 上午：**伏见稻荷大社**（早去避开人流）\n- 下午：清水寺、二年坂\n\n## 第二天\n- 岚山竹林、天龙寺\n\n| 项目 | 预算 |\n|---|---|\n| 住宿 | 2400 |\n| 交通 | 600 |' : '## Day 1\n- Morning: **Fushimi Inari** (go early)\n- Afternoon: Kiyomizu-dera, Ninenzaka\n\n## Day 2\n- Arashiyama bamboo grove, Tenryu-ji\n\n| Item | Budget |\n|---|---|\n| Hotel | $330 |\n| Transport | $80 |', { model: 'gpt-4o', usage: u }),
    ], { tags: [zh ? '旅行' : 'travel'], folderId: 'f1', pinned: true }),
    C('s22', zh ? '周报润色' : 'Polish weekly report', [M('x', 'user', 'hi')], { folderId: 'f1', tags: [zh ? '工作' : 'work'] }),
    C('s333', zh ? 'SQL 慢查询优化' : 'Slow SQL tuning', [M('y', 'user', 'hi')], { folderId: 'f2' }),
    C('s4444', zh ? '学习 Rust 所有权' : 'Learning Rust ownership', [M('z', 'user', 'hi')]),
  ]
}
for (const theme of ['light', 'dark'] as const) for (const lang of ['zh', 'en'] as const) {
  test(`p2 screenshot ${theme}-${lang}`, async () => {
    const zh = lang === 'zh'
    await start({ theme, language: lang, conversations: showcase(zh), settings: { defaultModel: 'gpt-4o' },
      files: { folders: [{ id: 'f1', name: zh ? '生活与工作' : 'Life & work' }, { id: 'f2', name: zh ? '技术' : 'Tech' }] } })
    await page.locator('.conv').first().click()
    await expect(page.getByTestId('conv-usage')).toBeVisible()
    await page.locator('.msg.assistant').last().hover()
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(SHOTS, `${theme}-${lang}.png`) })
  })
}
