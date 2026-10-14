import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, seedUserData, send } from './helpers'
// @ts-ignore
import { startMockServer, REPLY } from '../tests/mock-server.mjs'
import { zhCN } from '../src/renderer/locales/zh-CN'
import { en } from '../src/renderer/locales/en'

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'p0')
fs.mkdirSync(SHOTS, { recursive: true })
let mock: any
test.beforeAll(async () => { mock = await startMockServer() })
test.afterAll(async () => { await mock.close() })

let app: ElectronApplication, page: Page, ud: string, consoleErrors: string[]
async function start(seed: Partial<Parameters<typeof seedUserData>[0]> = {}) {
  ud = seedUserData({ mockUrl: mock.url, ...seed })
  ;({ app, page, consoleErrors } = await launch(ud))
}
test.afterEach(async ({}, info) => {
  if (page && info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  await app?.close().catch(() => {})
})

async function newChatAndSend(text: string) {
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  await send(page, text)
}

test('launches, security settings on, plaintext API key migrated to encrypted', async () => {
  await start()
  expect(await page.title()).toBe('ChatBox Clone')
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const p = (w.webContents as any).getLastWebPreferences?.() || {}
    return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox, webSecurity: p.webSecurity }
  })
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true })
  // renderer has no node and CSP is present
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined')
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("script-src 'self'")
  // renderer cannot fetch the network directly (connect-src 'self')
  const direct = await page.evaluate((u) => fetch(u + '/models').then(() => 'ok', e => 'blocked:' + e.message), mock.url)
  expect(direct).toMatch(/^blocked/)
  // key migration
  const secure = await page.evaluate(() => (window as any).api.secureStatus())
  const onDisk = fs.readFileSync(path.join(ud, 'data', 'settings.json'), 'utf8')
  test.info().annotations.push({ type: 'safeStorage', description: JSON.stringify(secure) })
  // Windows (DPAPI) / macOS always have secure storage; on Linux it needs a keyring daemon
  if (process.platform !== 'linux' || process.env.EXPECT_SAFE_STORAGE) expect(secure.available).toBe(true)
  if (secure.available) {
    expect(onDisk).not.toContain('sk-plaintext-e2e')
    expect(onDisk).toContain('enc:v1:')
  }
})

test('new conversation, streamed reply from mock server', async () => {
  await start()
  await newChatAndSend('你好')
  // while streaming, the stop button is visible and a partial reply is shown
  await expect(page.getByRole('button', { name: new RegExp(zhCN.stop) })).toBeVisible()
  const bubble = page.locator('.msg.assistant .bubble').last()
  await expect(bubble).toContainText(REPLY[0])
  const partial = await bubble.innerText()
  expect(partial).not.toContain(REPLY[REPLY.length - 1].trim())
  await expect(bubble).toContainText(REPLY.join('').trim(), { timeout: 10_000 })
  await expect(page.getByRole('button', { name: new RegExp(zhCN.send) })).toBeVisible()
  // conversation auto-titled from the first message
  await expect(page.locator('.conv.active .title')).toContainText('你好')
  await page.screenshot({ path: path.join(SHOTS, 'e2e-streamed-reply.png') })
})

const errorCases: [string, string, string][] = [
  ['mock-401', 'auth', zhCN.err_auth],
  ['mock-429', 'rate_limit', zhCN.err_rate_limit],
  ['mock-timeout', 'timeout', zhCN.err_timeout],
  ['mock-disconnect', 'disconnected', zhCN.err_disconnected],
]
for (const [model, code, text] of errorCases) {
  test(`friendly localized error: ${code}`, async () => {
    await start({ model })
    await newChatAndSend('test ' + code)
    const err = page.locator('.msg.assistant .error').last()
    await expect(err).toHaveAttribute('data-error-code', code, { timeout: 15_000 })
    await expect(err).toContainText(text)
    if (code === 'disconnected') await expect(page.locator('.msg.assistant .bubble').last()).toContainText(REPLY[0]) // partial text kept
    await page.screenshot({ path: path.join(SHOTS, `e2e-error-${code}.png`) })
  })
}

test('friendly localized error: network down (English UI)', async () => {
  await start({ language: 'en' })
  await page.getByRole('button', { name: new RegExp(en.newChat) }).first().click()
  await page.locator('.chathead select').selectOption('down')
  await send(page, 'hello')
  const err = page.locator('.msg.assistant .error').last()
  await expect(err).toHaveAttribute('data-error-code', 'network', { timeout: 15_000 })
  await expect(err).toContainText(en.err_network)
  await page.screenshot({ path: path.join(SHOTS, 'e2e-error-network-en.png') })
})

test('switch theme and language in settings', async () => {
  await start()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.keyboard.press('Control+,')
  await page.getByRole('button', { name: zhCN.general, exact: true }).click()
  const selects = page.locator('.modal .form select')
  await selects.nth(1).selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await selects.nth(0).selectOption('en')
  await expect(page.locator('.modal h2')).toHaveText(en.settings)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: new RegExp(en.newChat) }).first()).toBeVisible()
  // persisted across restart
  await app.close()
  ;({ app, page } = await launch(ud))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: new RegExp(en.newChat) }).first()).toBeVisible()
})

test('export JSON and import it back', async () => {
  await start()
  await newChatAndSend('导出测试')
  await expect(page.locator('.msg.assistant .bubble').last()).toContainText(REPLY.join('').trim(), { timeout: 10_000 })
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-')), 'export.json')
  await app.evaluate(({ dialog }, p) => { (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: p }) }, out)
  await page.getByRole('button', { name: new RegExp(zhCN.exportJson) }).click()
  await expect.poll(() => fs.existsSync(out)).toBe(true)
  const data = JSON.parse(fs.readFileSync(out, 'utf8'))
  expect(data.conversations[0].messages[0].content).toBe('导出测试')
  // markdown export of the current conversation
  const md = out.replace('.json', '.md')
  await app.evaluate(({ dialog }, p) => { (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: p }) }, md)
  await page.getByRole('button', { name: zhCN.exportMdShort }).click()
  await expect.poll(() => fs.existsSync(md) && fs.readFileSync(md, 'utf8')).toContain('## User')
  // delete conversation, then import
  page.once('dialog', d => d.accept())
  await page.locator('.conv.active').hover()
  await page.locator('.conv.active .acts button').nth(2).click()
  await expect(page.locator('.conv')).toHaveCount(0)
  await app.evaluate(({ dialog }, p) => { (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, out)
  await page.getByRole('button', { name: new RegExp(zhCN.importData) }).click()
  await expect(page.locator('.conv')).toHaveCount(1)
  await page.locator('.conv').first().click()
  await expect(page.locator('.msg.user').first()).toContainText('导出测试')
})

test('tool calls require confirmation (deny, then always allow)', async () => {
  await start({ model: 'mock-tool' })
  await app.evaluate(({ dialog }) => {
    const g = globalThis as any; g.__boxes = []
    ;(dialog as any).showMessageBox = async (_w: any, o: any) => { g.__boxes.push(o); return g.__boxes.length === 1 ? { response: 1, checkboxChecked: false } : { response: 0, checkboxChecked: true } }
  })
  await newChatAndSend('现在几点')
  await expect(page.locator('.msg.assistant .bubble').last()).toContainText('TOOL_RESULT: 用户拒绝', { timeout: 10_000 })
  const box = await app.evaluate(() => (globalThis as any).__boxes[0])
  expect(box.message).toContain('builtin__get_current_time')
  expect(box.detail).toContain('{}')
  expect(box.buttons).toEqual(['允许', '拒绝'])
  // second time: allow + always
  await send(page, '再问一次')
  await expect(page.locator('.msg.assistant .bubble').last()).toContainText(/TOOL_RESULT: \w{3} /, { timeout: 10_000 })
  expect(JSON.parse(fs.readFileSync(path.join(ud, 'tool-allowlist.json'), 'utf8'))).toEqual(['builtin__get_current_time'])
  // third time: no dialog
  await send(page, '第三次')
  await expect(page.locator('.msg.assistant')).toHaveCount(6, { timeout: 10_000 })
  expect(await app.evaluate(() => (globalThis as any).__boxes.length)).toBe(2)
})

// ---------- screenshots of the real UI in all four theme/language combos ----------
const demoAnswer = (zh: boolean) => [
  zh ? '下面是快速排序的 **TypeScript** 实现：' : 'Here is a **TypeScript** quicksort:', '', '```ts', 'function quickSort(a: number[]): number[] {', '  if (a.length <= 1) return a', '  const [p, ...rest] = a',
  '  return [...quickSort(rest.filter(x => x < p)), p, ...quickSort(rest.filter(x => x >= p))]', '}', '```', '',
  zh ? '平均复杂度 $O(n \\log n)$，最坏情况：' : 'Average $O(n \\log n)$, worst case:', '', '$$T(n) = T(n-1) + O(n) = O(n^2)$$', '',
  '```mermaid', 'graph LR', zh ? '  A[选择基准] --> B[分区]' : '  A[Pick pivot] --> B[Partition]', zh ? '  B --> C[递归左侧]' : '  B --> C[Recurse left]', zh ? '  B --> D[递归右侧]' : '  B --> D[Recurse right]', '```',
  '', '<img src=x onerror="document.title=\'XSS\'">',
].join('\n')
const demoConvs = (zh: boolean) => {
  const now = Date.now()
  const c = (id: string, title: string, pinned: boolean, msgs: any[], dt: number) => ({ id, title, pinned, providerId: 'mock', model: 'mock-ok', systemPrompt: '', createdAt: now - dt, updatedAt: now - dt, messages: msgs })
  const m = (role: string, content: string) => ({ id: Math.random().toString(36).slice(2), role, content, model: role === 'assistant' ? 'mock-ok' : undefined, createdAt: now })
  return [
    c('c1', zh ? '快速排序实现与复杂度' : 'Quicksort & complexity', true, [m('user', zh ? '用 TypeScript 写快速排序并画流程图' : 'Write quicksort in TypeScript with a flowchart'), m('assistant', demoAnswer(zh))], 1000),
    c('c2', zh ? '周报润色' : 'Polish weekly report', false, [m('user', 'hi')], 50000),
    c('c3', zh ? '翻译：产品介绍' : 'Translate: product intro', false, [m('user', 'hi')], 90000),
  ]
}
for (const theme of ['light', 'dark'] as const) for (const lang of ['zh', 'en'] as const) {
  test(`screenshot ${theme}-${lang}`, async () => {
    await start({ theme, language: lang, conversations: demoConvs(lang === 'zh') })
    await expect(page.locator('.mermaid svg')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.katex').first()).toBeVisible()
    await expect(page.locator('.mermaid svg')).toContainText(lang === 'zh' ? '分区' : 'Partition') // labels survive DOMPurify
    await page.waitForTimeout(500)
    // raw HTML in markdown is not rendered -> no XSS
    expect(await page.title()).toBe('ChatBox Clone')
    expect(await page.locator('.bubble img[src="x"]').count()).toBe(0)
    expect(consoleErrors.filter(e => /Content Security Policy/i.test(e))).toEqual([])
    await page.screenshot({ path: path.join(SHOTS, `${theme}-${lang}.png`) })
  })
}
