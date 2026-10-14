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
  // (select by title, not position: the list is ordered by last update, and A may still be finishing its last save)
  await page.locator('.conv', { hasText: '第一句' }).click()
  await expect(T).toHaveAttribute('aria-pressed', 'true'); await expect(R).toHaveAttribute('aria-pressed', 'true'); await expect(S).toHaveAttribute('aria-pressed', 'false')
  await page.locator('.conv', { hasText: zhCN.untitled }).click()
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

test('A6: plaintext keys never reach the renderer (window state, IPC payloads, storage); requests still authenticated; 已保存 + 替换/清除', async () => {
  const audit = path.join(test.info().outputDir, 'ipc-audit.jsonl')
  fs.mkdirSync(path.dirname(audit), { recursive: true })
  const SECRETS = ['sk-plaintext-e2e', 'dav-secret-e2e', 'tvly-secret-e2e']
  const ud = seedUserData({ mockUrl: mock.url, settings: { webdav: { enabled: false, url: mock.url.replace(/\/v1$/, '') + '/dav/', username: 'u', password: 'dav-secret-e2e' },
    webSearch: { enabled: false, provider: 'tavily', maxResults: 3, tavilyKey: 'tvly-secret-e2e', bingKey: '', braveKey: '', searxngUrl: '', endpoints: { tavily: mock.url.replace(/\/v1$/, '') + '/search/tavily' } } } })
  ;({ app, page } = await launch(ud, { TIDEQUILL_IPC_AUDIT: audit }))
  // a chat request and a web search still carry the real keys (inserted by main)
  await newChat()
  await page.getByTestId('search-toggle').click()
  await send(page, '你好')
  await expect(page.locator('.msg.assistant').last()).toContainText('潮汐主要由') // reply built on the search results
  expect(mock.auths.at(-1)).toBe('Bearer sk-plaintext-e2e')
  expect(mock.searches.at(-1).auth).toBe('Bearer tvly-secret-e2e')
  // settings UI: saved keys are shown as 已保存 with 替换 / 清除
  await page.keyboard.press('Control+,'); await page.locator('.tabs button[data-tab="providers"]').click()
  await expect(page.getByTestId('api-key-state')).toHaveText(zhCN.secretSaved)
  await expect(page.getByTestId('api-key-replace')).toHaveText(zhCN.secretReplace)
  await expect(page.getByTestId('api-key-clear')).toHaveText(zhCN.secretClear)
  await page.screenshot({ path: path.join(SHOTS, 'saved-key-ui.png') })
  await page.locator('.tabs button[data-tab="searchTab"]').click()
  await expect(page.getByTestId('search-key-state')).toHaveText(zhCN.secretSaved)
  await page.locator('.tabs button[data-tab="data"]').click()
  await expect(page.getByTestId('webdav-pass-state')).toHaveText(zhCN.secretSaved)
  // renderer state: DOM, input values, storage, the settings object the renderer receives
  const dump = await page.evaluate(async () => JSON.stringify({
    html: document.documentElement.outerHTML,
    inputs: [...document.querySelectorAll('input,textarea')].map(e => (e as HTMLInputElement).value),
    local: { ...localStorage }, session: { ...sessionStorage },
    settings: await (window as any).api.kvGet('settings'),
  }))
  for (const s of SECRETS) expect(dump, s).not.toContain(s)
  // IPC: every reply and event main sent to the renderer during the session
  const ipc = fs.readFileSync(audit, 'utf8')
  expect(ipc).toContain('"ch":"kv:get"')
  for (const s of SECRETS) expect(ipc, s).not.toContain(s)
  // a sentinel cannot be sent to another host
  const leak = await page.evaluate(async (u) => {
    const s = await (window as any).api.kvGet('settings'); const k = s.providers.find((p: any) => p.id === 'mock').apiKey
    try { const r = await fetchViaBridge(u + '/collect', k); return r } catch (e: any) { return 'blocked: ' + e.message }
    async function fetchViaBridge(url: string, key: string) {
      return await new Promise<string>((res, rej) => {
        const id = 'leak-' + Date.now()
        ;(window as any).api.httpStart(id, { url, method: 'GET', headers: { Authorization: 'Bearer ' + key } }, (ev: any) => { if (ev.type === 'error') rej(new Error(ev.message)); if (ev.type === 'head') res('sent ' + ev.status) })
      })
    }
  }, 'http://localhost:' + mock.port)
  expect(leak).toMatch(/blocked: .*bound to 127\.0\.0\.1/)
  // replace: new key goes to main once, UI returns to 已保存; clear removes it
  await page.locator('.tabs button[data-tab="providers"]').click()
  await page.getByTestId('api-key-replace').click()
  await page.getByTestId('api-key').fill('sk-replaced-e2e')
  await page.getByTestId('api-key-save').click()
  await expect(page.getByTestId('api-key-state')).toBeVisible()
  await page.keyboard.press('Escape')
  await send(page, '换了密钥')
  await expect(page.locator('.msg.assistant')).toHaveCount(2)
  await expect(page.locator('.msg.assistant').last()).toContainText('潮汐主要由')
  expect(mock.auths.at(-1)).toBe('Bearer sk-replaced-e2e')
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain('sk-replaced-e2e')
  await page.keyboard.press('Control+,'); await page.locator('.tabs button[data-tab="providers"]').click()
  page.once('dialog', d => d.accept())
  await page.getByTestId('api-key-clear').click()
  await expect(page.getByTestId('api-key')).toHaveValue('')
  await expect(page.getByTestId('badge-mock')).toHaveAttribute('data-state', 'nokey')
test('B7: provider badges 未配置 / 连接正常 / 连接失败 with last test time; Ollama probed', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, settings: { providers: [
    { id: 'mock', name: 'OpenAI 兼容', type: 'openai', apiKey: 'sk-mock-1', baseURL: mock.url, models: ['mock-ok'] },
    { id: 'down', name: 'Down', type: 'openai', apiKey: 'x', baseURL: 'http://127.0.0.1:9/v1', models: ['mock-ok'] },
    { id: 'nokey', name: 'Anthropic', type: 'anthropic', apiKey: '', baseURL: 'https://api.anthropic.com', models: [] },
    { id: 'ollama', name: 'Ollama', type: 'ollama', apiKey: '', baseURL: mock.url.replace(/\/v1$/, ''), models: [] },
  ] } })))
  await page.keyboard.press('Control+,'); await page.locator('.tabs button[data-tab="providers"]').click()
  const B = (id: string) => page.getByTestId('badge-' + id)
  await expect(B('mock')).toHaveAttribute('data-state', 'ok', { timeout: 10_000 }); await expect(B('mock')).toContainText(zhCN.provConnected)
  await expect(B('down')).toHaveAttribute('data-state', 'fail', { timeout: 10_000 }); await expect(B('down')).toContainText(zhCN.provFail)
  await expect(B('nokey')).toHaveAttribute('data-state', 'nokey'); await expect(B('nokey')).toContainText(zhCN.provNotConfigured)
  await expect(B('ollama')).toHaveAttribute('data-state', 'ok', { timeout: 10_000 })
  expect(await B('mock').getAttribute('data-tip')).toContain(zhCN.provLastTest.split('{time}')[0])
  expect(await B('ollama').getAttribute('data-tip')).toContain('/api/tags')
  await page.getByTestId('test-conn').click()
  await expect(page.getByTestId('last-test')).toBeVisible()
  await page.mouse.move(600, 20); await page.waitForTimeout(150)
  await shot('badges')
  await B('down').hover(); await page.waitForTimeout(200)
  await shot('badges-tooltip')
})

test('B8: model dropdown grouped by family, newest first, older collapsed, search shows all', async () => {
  const models = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4.1', 'gpt-5', 'gpt-5.1', 'claude-3-5-sonnet-20241022', 'claude-sonnet-4-20250514', 'claude-sonnet-4-5-20250929', 'claude-sonnet-5-5', 'claude-3-haiku-20240307', 'claude-haiku-4-5', 'gemini-1.5-pro', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro', 'mock-ok']
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, settings: { providers: [{ id: 'many', name: 'Many', type: 'openai', apiKey: 'k', baseURL: 'http://127.0.0.1:9/v1', models }], defaultProviderId: 'many', defaultModel: 'gpt-5' } })))
  await newChat()
  await page.locator('.modelbtn').click()
  const heads = page.locator('.modelgroup-head')
  await expect(heads).toHaveText(['GPT', 'Claude Sonnet', 'Claude Haiku', 'Gemini', zhCN.modelsOther])
  const gpt = page.locator('.modelgroup[data-family="GPT"] .modelopt')
  await expect(gpt).toHaveText(['gpt-5.1', 'gpt-5', 'gpt-4.1'])
  await expect(page.locator('.modelgroup[data-family="Claude Sonnet"] .modelopt').first()).toHaveText('claude-sonnet-5-5')
  await shot('model-dropdown-grouped')
  await page.locator('.modelgroup[data-family="GPT"] [data-testid="model-older"]').click()
  await expect(gpt).toHaveCount(5)
  // keyboard navigation walks the visible list
  await page.keyboard.press('ArrowDown')
  await page.getByPlaceholder(zhCN.modelSearch).fill('sonnet')
  await expect(page.locator('.modelgroup[data-family="Claude Sonnet"] .modelopt')).toHaveCount(4)
  await expect(page.locator('[data-testid="model-older"]')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(page.locator('.modelbtn')).toContainText('sonnet')
})

test('B9: auto-title still runs when the first reply failed (fallback title is replaced after the first success)', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, model: 'mock-401', settings: { ...NO_DEFAULTS, autoTitle: true } })))
  await newChat()
  await send(page, '帮我规划周末去杭州的行程')
  await expect(page.locator('.msg.assistant').last()).toContainText('401')
  await expect(page.locator('.conv.active, .conv.on').first()).toContainText('帮我规划周末去杭州') // fallback placeholder
  await page.locator('.modelbtn').click(); await page.locator('.modelopt', { hasText: /^mock-ok$/ }).click()
  await send(page, '再试一次')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock')
  await expect(page.locator('.conv').first()).toContainText('模拟对话标题', { timeout: 10_000 })
})

test('B10/B11/B12: context hover breakdown, top-bar tooltips, optional model name in system prompt', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, settings: { ...NO_DEFAULTS, tellModel: true } })))
  await newChat()
  await send(page, '你好，介绍一下你自己')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock')
  const sys = lastBody().messages.find((m: any) => m.role === 'system')
  expect(sys?.content).toContain('mock-ok')
  // B10
  await page.getByTestId('tools-toggle').click()
  await page.locator('.composer textarea').fill('下一个问题')
  const ctx = page.getByTestId('ctx-usage')
  await expect.poll(async () => (await ctx.getAttribute('data-tip')) || '').toMatch(new RegExp(zhCN.ctxBreakdown.split('\n')[2].split('{')[0]))
  const tip = (await ctx.getAttribute('data-tip'))!
  expect(tip).toMatch(/系统提示词：\d/); expect(tip).not.toMatch(/工具定义：0\n/)
  await ctx.hover(); await page.waitForTimeout(200)
  await shot('context-usage-breakdown')
  // B11
  for (const id of ['sys-btn', 'find-btn', 'compare-btn', 'convsettings-btn', 'export-btn']) expect(await page.getByTestId(id).getAttribute('data-tip')).toBeTruthy()
  expect(await page.getByTestId('compare-btn').getAttribute('data-tip')).toContain(zhCN.compareTip2)
  await page.getByTestId('compare-btn').hover(); await page.waitForTimeout(200)
  await shot('topbar-compare-tooltip')
  // B12 off -> no line
  await page.keyboard.press('Control+,'); await page.locator('.tabs button[data-tab="chat"]').click()
  await page.getByTestId('tell-model').uncheck(); await page.keyboard.press('Escape')
  await send(page, '再来')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock')
  expect(JSON.stringify(lastBody().messages)).not.toContain('当前使用的模型')
})
