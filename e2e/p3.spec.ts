import { test, expect, type ElectronApplication, type Page, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appPath, launch, seedUserData } from './helpers'
// @ts-ignore
import { startMockServer, UPDATE_VERSION } from '../tests/mock-server.mjs'
import { zhCN } from '../src/renderer/locales/zh-CN'
import { en } from '../src/renderer/locales/en'

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'p3')
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
const showcase = (zh: boolean) => [
  C('s1', zh ? '写一首关于潮汐的短诗' : 'A short poem about tides', [
    M('q1', 'user', zh ? '写一首关于潮汐的四行短诗，并解释意象' : 'Write a four-line poem about tides and explain the imagery'),
    M('r1', 'assistant', zh ? '> 月牵海水起，\n> 夜写一行诗；\n> 退潮留白处，\n> 笔落是归期。\n\n**意象**：\n- *潮汐* 象征往复的思绪\n- *笔与留白* 呼应“潮笺”：在潮水退去处写下文字\n\n```python\nimport math\ntide = [round(math.sin(h / 12.42 * 2 * math.pi), 2) for h in range(6)]\nprint(tide)\n```'
      : '> The moon pulls the sea ashore,\n> the night writes one more line;\n> where the ebb leaves blank sand,\n> the quill sets down its sign.\n\n**Imagery**:\n- *Tides* stand for recurring thoughts\n- *Quill and blank sand* echo the name Tidequill\n\n```python\nimport math\ntide = [round(math.sin(h / 12.42 * 2 * math.pi), 2) for h in range(6)]\nprint(tide)\n```', { usage: { input: 312, output: 148 } }),
  ], { pinned: true, folderId: 'f1', tags: [zh ? '写作' : 'writing'] }),
  C('s22', zh ? '周报润色' : 'Polish weekly report', [M('x', 'user', 'hi')], { folderId: 'f1' }),
  C('s333', zh ? 'SQL 慢查询优化' : 'Slow SQL tuning', [M('y', 'user', 'hi')], { folderId: 'f2', tags: [zh ? '工作' : 'work'] }),
  C('s4444', zh ? '学习 Rust 所有权' : 'Learning Rust ownership', [M('z', 'user', 'hi')]),
]
const seed = (lang: 'zh' | 'en', theme: 'light' | 'dark') => seedUserData({ mockUrl: mock.url, language: lang, theme, conversations: showcase(lang === 'zh'),
  files: { folders: [{ id: 'f1', name: lang === 'zh' ? '创作' : 'Writing' }, { id: 'f2', name: lang === 'zh' ? '技术' : 'Tech' }] } })

test('new name in window title, sidebar, version metadata', async () => {
  ;({ app, page } = await launch(seed('zh', 'light')))
  expect(await page.title()).toBe('Tidequill')
  await expect(page.locator('.brand')).toContainText('潮笺 Tidequill')
  await expect(page.locator('.brand img')).toBeVisible()
  const meta = await app.evaluate(({ app, BrowserWindow }) => ({ name: app.getName(), version: app.getVersion(), title: BrowserWindow.getAllWindows()[0].getTitle() }))
  expect(meta).toEqual({ name: 'Tidequill', version: '1.0.0', title: 'Tidequill' })
  expect(await page.content()).not.toMatch(/chat\s*box/i)
})

test('About page: name, version, license, repo, third-party notices, check updates', async () => {
  const env: Record<string, string> = { TIDEQUILL_UPDATE_URL: `http://127.0.0.1:${mock.port}/updates` }
  if (process.platform === 'linux') env.APPIMAGE = '/tmp/fake-tidequill.AppImage'
  ;({ app, page } = await launch(seed('zh', 'light'), env))
  await page.locator('.sidenav button', { hasText: zhCN.about }).click()
  const about = page.getByTestId('about')
  await expect(about).toContainText('潮笺 Tidequill')
  await expect(page.getByTestId('about-version')).toContainText('1.0.0')
  await expect(about).toContainText('MIT')
  await expect(about).toContainText('追逐')
  await expect(page.getByTestId('about-repo')).toContainText('https://github.com/KirinWhip/tidequill')
  await expect(about.locator('img')).toHaveJSProperty('complete', true)
  expect(await about.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
  await page.screenshot({ path: path.join(SHOTS, 'about.png') })
  // notices bundled with the app
  await about.locator('details.notices summary').click()
  const notices = await page.getByTestId('notices').innerText()
  expect(notices).toContain('THIRD-PARTY SOFTWARE NOTICES'); expect(notices).toMatch(/react@\d/); expect(notices).toMatch(/Packages: \d{3}/)
  expect(notices).not.toMatch(/\bGPL-|AGPL|LGPL/)
  // repo link opens externally (stubbed)
  await app.evaluate(({ shell }) => { (globalThis as any).__opened = []; (shell as any).openExternal = async (u: string) => { (globalThis as any).__opened.push(u) } })
  await page.getByTestId('about-repo').click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).__opened)).toEqual(['https://github.com/KirinWhip/tidequill'])
  await page.getByTestId('about-check-update').click()
  await expect(page.getByTestId('about-msg')).toContainText(zhCN.updateAvailable + UPDATE_VERSION, { timeout: 20_000 })
  await about.locator('details.notices summary').click()
  await page.getByTestId('about-check-update').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, 'about-update.png') })
})

test('About page in English', async () => {
  ;({ app, page } = await launch(seed('en', 'dark')))
  await page.locator('.sidenav button', { hasText: en.about }).click()
  await expect(page.getByTestId('about')).toContainText(en.aboutTagline)
  await page.screenshot({ path: path.join(SHOTS, 'about-en-dark.png') })
})

test('upgrade from 0.x: data migrated from the legacy profile folder', async () => {
  test.skip(process.platform !== 'linux', 'appData override via XDG_CONFIG_HOME is Linux-only')
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'xdg-'))
  const legacy = path.join(cfg, 'ChatBox Clone', 'data')
  fs.mkdirSync(legacy, { recursive: true })
  fs.writeFileSync(path.join(legacy, 'settings.json'), JSON.stringify({ language: 'zh', theme: 'light', onboarded: true, providers: [{ id: 'mock', name: 'Mock', type: 'openai', apiKey: 'k', baseURL: mock.url, models: ['mock-ok'] }], defaultProviderId: 'mock', defaultModel: 'mock-ok', tray: false, globalShortcut: '', autoCheckUpdate: false }))
  fs.writeFileSync(path.join(legacy, 'conversations.json'), JSON.stringify([C('old1', '旧版本的对话', [M('a', 'user', '来自 0.4')])]))
  const { TIDEQUILL_USER_DATA, ...env } = process.env as any
  app = await electron.launch({ executablePath: appPath(), args: ['--no-sandbox', ...(process.env.E2E_EXTRA_ARGS || '').split(' ').filter(Boolean)], env: { ...env, XDG_CONFIG_HOME: cfg } })
  page = await app.firstWindow()
  await expect(page.locator('.conv')).toContainText(['旧版本的对话'], { timeout: 20_000 })
  expect(fs.existsSync(path.join(cfg, 'Tidequill', 'data', 'conversations.json'))).toBe(true)
  expect(fs.existsSync(path.join(legacy, 'conversations.json'))).toBe(true) // legacy folder left untouched
})

for (const theme of ['light', 'dark'] as const) for (const lang of ['zh', 'en'] as const) {
  test(`p3 screenshot ${theme}-${lang}`, async () => {
    ;({ app, page } = await launch(seed(lang, theme)))
    await page.locator('.conv').first().click()
    await expect(page.locator('.hljs, pre code').first()).toBeVisible()
    await page.locator('.msg.assistant').last().hover()
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(SHOTS, `${theme}-${lang}.png`) })
  })
}
