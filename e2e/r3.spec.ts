// Round 3: per-conversation toggles, web search UX, Anthropic 400, keys in main, badges, model groups, context breakdown
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, seedUserData, send } from './helpers'
// @ts-ignore
import { startMockServer } from '../tests/mock-server.mjs'
import { zhCN } from '../src/renderer/locales/zh-CN'

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'r3')
fs.mkdirSync(SHOTS, { recursive: true })
let mock: any
test.beforeAll(async () => { mock = await startMockServer() })
test.afterAll(async () => { await mock.close() })
let app: ElectronApplication, page: Page
test.afterEach(async ({}, info) => {
  if (page && info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  await app?.close().catch(() => {})
})
const shot = (n: string) => page.screenshot({ path: path.join(SHOTS, n + '.png') })
const NO_DEFAULTS = { chatDefaults: { reasoning: false, tools: false, webSearch: false } }
const newChat = () => page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
const lastBody = () => mock.requests.at(-1)

test('A3: new conversations start with deep thinking / tools / web search off; each conversation keeps its own state; tooltips explain cost', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, settings: { ...NO_DEFAULTS, builtinTools: true,
    webSearch: { enabled: true, provider: 'tavily', maxResults: 3, tavilyKey: 'tvly-x', bingKey: '', braveKey: '', searxngUrl: '', endpoints: { tavily: mock.url.replace(/\/v1$/, '') + '/search/tavily' } } } })))
  await newChat()
  const R = page.getByTestId('reasoning-toggle'), T = page.getByTestId('tools-toggle'), S = page.getByTestId('search-toggle')
  for (const x of [R, T, S]) await expect(x).toHaveAttribute('aria-pressed', 'false')
  // nothing extra is sent when all are off
  const n0 = mock.searches.length
  await send(page, '第一句')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock')
  expect(lastBody().tools).toBeUndefined(); expect(lastBody().reasoning_effort).toBeUndefined(); expect(mock.searches.length).toBe(n0)
  // tooltips: effect + cost
  expect(await R.getAttribute('data-tip')).toContain(zhCN.reasoningTip3)
  expect(await T.getAttribute('data-tip')).toContain(zhCN.toolsTip3)
  expect(await S.getAttribute('data-tip')).toContain(zhCN.webSearchTip3)
  for (const tip of [zhCN.reasoningTip3, zhCN.toolsTip3, zhCN.webSearchTip3]) expect(tip).toMatch(/token/)
  // conversation A: turn tools + thinking on
  await T.click(); await R.click()
  await expect(T).toHaveAttribute('aria-pressed', 'true'); await expect(R).toHaveAttribute('aria-pressed', 'true')
  await send(page, '第二句')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock')
  expect(lastBody().tools?.length).toBeGreaterThan(0); expect(lastBody().reasoning_effort).toBeTruthy()
  // conversation B starts off again
  await newChat()
  for (const x of [R, T, S]) await expect(x).toHaveAttribute('aria-pressed', 'false')
  await S.click(); await expect(S).toHaveAttribute('aria-pressed', 'true')
  await T.hover()
  await page.waitForTimeout(150)
  await shot('toggles-tooltip-tools')
  await R.hover(); await page.waitForTimeout(150); await shot('toggles-tooltip-reasoning')
  await S.hover(); await page.waitForTimeout(150); await shot('toggles-tooltip-search')
  // back to A: its own state is remembered (also after restart, it is stored with the conversation)
  await page.locator('.conv').nth(1).click()
  await expect(T).toHaveAttribute('aria-pressed', 'true'); await expect(R).toHaveAttribute('aria-pressed', 'true'); await expect(S).toHaveAttribute('aria-pressed', 'false')
  await page.locator('.conv').first().click()
  await expect(S).toHaveAttribute('aria-pressed', 'true'); await expect(T).toHaveAttribute('aria-pressed', 'false')
  // defaults are configurable in Settings > Chat
  await page.keyboard.press('Control+,'); await page.locator('.tabs button[data-tab="chat"]').click()
  for (const k of ['reasoning', 'tools', 'webSearch']) await expect(page.getByTestId('default-' + k)).not.toBeChecked()
  await page.getByTestId('default-tools').check()
  await page.keyboard.press('Escape')
  await newChat()
  await expect(T).toHaveAttribute('aria-pressed', 'true'); await expect(R).toHaveAttribute('aria-pressed', 'false'); await expect(S).toHaveAttribute('aria-pressed', 'false')
})

test('A3: settings without chatDefaults (upgrade from 1.0.1) start with all three off', async () => {
  const ud = seedUserData({ mockUrl: mock.url, settings: { toolsEnabled: true } })
  const f = path.join(ud, 'data', 'settings.json'); const s = JSON.parse(fs.readFileSync(f, 'utf8')); delete s.chatDefaults; fs.writeFileSync(f, JSON.stringify(s))
  ;({ app, page } = await launch(ud))
  await newChat()
  for (const id of ['reasoning-toggle', 'tools-toggle', 'search-toggle']) await expect(page.getByTestId(id)).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('search-toggle')).toBeDisabled() // no search key configured
})
