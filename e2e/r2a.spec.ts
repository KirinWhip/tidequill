// Round 2 stage A: no-price indicator, request debug view / no tools by default, line breaks, reasoning, auto title
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, seedUserData, send } from './helpers'
// @ts-ignore
import { startMockServer } from '../tests/mock-server.mjs'
import { zhCN } from '../src/renderer/locales/zh-CN'
import { en } from '../src/renderer/locales/en'

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'r2-A')
fs.mkdirSync(SHOTS, { recursive: true })
let mock: any
test.beforeAll(async () => { mock = await startMockServer() })
test.afterAll(async () => { await mock.close() })
let app: ElectronApplication, page: Page
test.afterEach(async ({}, info) => {
  if (page && info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  await app?.close().catch(() => {})
})
const now = Date.now()
const M = (id: string, role: string, content: string, extra: any = {}) => ({ id, role, content, createdAt: now, ...(role === 'assistant' ? { model: 'gpt-4o' } : {}), ...extra })
const C = (id: string, title: string, messages: any[], extra: any = {}) => ({ id, title, pinned: false, providerId: 'mock', model: 'gpt-4o', systemPrompt: '', createdAt: now, updatedAt: now - id.length, messages, ...extra })
const POEM_ZH = '> 床前明月光\n> 疑是地上霜\n> 举头望明月\n> 低头思故乡'
const POEM_EN = '> The moon pulls the sea ashore\n> the night writes one more line\n> where the ebb leaves blank sand\n> the quill sets down its sign'
const showcase = (zh: boolean) => [
  C('s1', zh ? '静夜思' : 'A tide poem', [
    M('q1', 'user', zh ? '默写《静夜思》，用引用格式，每句一行' : 'Write a four-line poem as a blockquote, one line each'),
    M('r1', 'assistant', (zh ? POEM_ZH : POEM_EN) + (zh ? '\n\n这首诗共四句，单个换行现在会正常显示为换行。' : '\n\nFour lines; a single newline now renders as a line break.'),
      { usage: { input: 31, output: 48 }, reasoning: zh ? '用户要求引用格式，每句单独一行。' : 'The user wants a blockquote with one line per verse.' }),
  ]),
  C('s22', zh ? '周报润色' : 'Polish weekly report', [M('x', 'user', 'hi')]),
]
const shot = (n: string) => page.screenshot({ path: path.join(SHOTS, n + '.png') })

for (const [lang, theme] of [['zh', 'light'], ['zh', 'dark'], ['en', 'light'], ['en', 'dark']] as const) {
  test(`overview ${theme}-${lang}`, async () => {
    ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, language: lang, theme, conversations: showcase(lang === 'zh') })))
    await page.locator('.conv').first().click()
    await expect(page.locator('.msg.assistant blockquote')).toBeVisible()
    await page.locator('.msg.assistant .reasoning summary').click()
    await shot(`${theme}-${lang}`)
  })
}

test('no price: indicator under title bar and in message footer jumps to the price table', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, conversations: [C('np', '未知价格模型', [M('u', 'user', 'hi'), M('a', 'assistant', 'hello', { model: 'mock-ok', usage: { input: 9, output: 3 } })], { model: 'mock-ok' })] })))
  await page.locator('.conv').first().click()
  const bar = page.getByTestId('no-price')
  await expect(bar).toHaveText(zhCN.noPrice)
  await expect(page.getByTestId('msg-no-price')).toContainText('—')
  await page.locator('.msg.assistant').last().hover()
  await shot('no-price')
  await page.getByTestId('msg-no-price').click()
  await expect(page.locator('.tabs button[data-tab="usageSettings"]')).toHaveClass(/on/)
  await expect(page.getByTestId('price-missing')).toContainText('mock-ok')
  await page.getByTestId('add-model-price').click()
  await expect(page.locator('.pricetable input').first()).toHaveValue('mock-ok')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('no-price')).toHaveCount(0)
  // a priced model shows a cost instead
  await expect(page.getByTestId('msg-usage')).not.toContainText(zhCN.noPrice)
})

test('default request carries no tools / no system prompt; debug view shows what was sent', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, settings: { builtinTools: false } })))
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  const before = mock.requests.length
  await send(page, '你好 你是谁 你能干啥?')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock', { timeout: 10_000 })
  const req = mock.requests.slice(before).find((r: any) => r.messages?.at(-1)?.content === '你好 你是谁 你能干啥?')
  expect(req.tools).toBeUndefined()
  expect(req.messages.filter((m: any) => m.role === 'system')).toHaveLength(0)
  await page.getByRole('button', { name: zhCN.convSettings }).click()
  await page.getByTestId('req-debug-toggle').click()
  await expect(page.getByTestId('req-tools')).toContainText('0 · 0 B')
  await expect(page.getByTestId('req-system')).toContainText('0 ')
  await expect(page.getByTestId('req-debug')).toContainText('你好 你是谁 你能干啥?')
  await expect(page.getByTestId('req-debug')).not.toContainText('sk-plaintext-e2e')
  await page.locator('.reqjson').scrollIntoViewIfNeeded()
  await shot('request-debug')
})

test('builtin tools are only sent when enabled in settings', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, settings: { builtinTools: true } })))
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  await send(page, 'tools on')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock', { timeout: 10_000 })
  const req = mock.requests.filter((r: any) => r.messages?.at(-1)?.content === 'tools on').at(-1)
  expect(req.tools.map((x: any) => x.function.name).sort()).toEqual(['builtin__calculator', 'builtin__get_current_time'])
})

test('single newlines render as line breaks (four-line poem blockquote)', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, model: 'mock-poem' })))
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  await send(page, '默写静夜思')
  const bq = page.locator('.msg.assistant blockquote').last()
  await expect(bq).toContainText('低头思故乡', { timeout: 10_000 })
  await expect(bq.locator('br')).toHaveCount(3)
  const h = await bq.evaluate(e => e.getBoundingClientRect().height)
  const lh = await bq.locator('p').evaluate(e => parseFloat(getComputedStyle(e).lineHeight) || 20)
  expect(h).toBeGreaterThan(lh * 3.5)
  await shot('poem-blockquote')
})

test('deep thinking: reasoning block is displayed', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, model: 'mock-ok' })))
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  await page.getByRole('button', { name: zhCN.reasoning, exact: true }).click()
  await send(page, '想一想再答')
  const r = page.locator('.msg.assistant .reasoning').last()
  await expect(r.locator('summary')).toContainText(zhCN.reasoningContent, { timeout: 10_000 })
  const req = mock.requests.filter((x: any) => x.messages?.at(-1)?.content === '想一想再答').at(-1)
  expect(req.reasoning_effort).toBe('high')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock', { timeout: 10_000 })
  await r.locator('summary').click()
  await expect(r.locator('.reasoning-body')).toContainText('先分析问题')
  await shot('reasoning-block')
})

test('auto title: summarized after first reply, toggle off keeps fallback, manual rename never overwritten', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, settings: { autoTitle: true } })))
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  await send(page, '帮我规划一下周末去杭州的行程安排')
  await expect(page.locator('.conv.active .title')).toHaveText('模拟对话标题', { timeout: 10_000 })
  const titleReqs = mock.requests.filter((r: any) => String(r.messages?.at(-1)?.content).startsWith(zhCN.titlePrompt))
  expect(titleReqs.length).toBeGreaterThan(0)
  expect(titleReqs.at(-1).tools).toBeUndefined()
  // manual rename (conversation settings) then a new chat: rename before the first message is kept
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  await page.getByRole('button', { name: zhCN.convSettings }).click()
  await page.locator('.modal .form label', { hasText: zhCN.name }).locator('input').fill('我的手动标题')
  await page.getByRole('button', { name: zhCN.save, exact: true }).click()
  const n = mock.requests.length
  await send(page, '第二个对话的问题')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock', { timeout: 10_000 })
  await page.waitForTimeout(800)
  await expect(page.locator('.conv.active .title')).toHaveText('我的手动标题')
  expect(mock.requests.slice(n).filter((r: any) => String(r.messages?.at(-1)?.content).startsWith(zhCN.titlePrompt))).toHaveLength(0)
  // toggle off in settings: falls back to the first message
  await page.keyboard.press('Control+,')
  await page.locator('.tabs button[data-tab="chat"]').click()
  await page.getByTestId('auto-title').uncheck()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  await send(page, '第三个对话')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock', { timeout: 10_000 })
  await page.waitForTimeout(800)
  await expect(page.locator('.conv.active .title')).toHaveText('第三个对话')
})

test('english UI strings for the new controls exist', async () => {
  expect(en.noPrice).toBeTruthy(); expect(en.viewRequest).toBeTruthy(); expect(en.autoTitle).toBeTruthy()
})
