// Round 2 stage B: custom title bar, provider settings, sidebar grouping, empty folders, reading width, context usage
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launch, seedUserData, send, dumpMockTimings } from './helpers'
// @ts-ignore
import { startMockServer } from '../tests/mock-server.mjs'
import { zhCN } from '../src/renderer/locales/zh-CN'
import { en } from '../src/renderer/locales/en'
import { colors } from '../src/renderer/theme/tokens'

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'r2-B')
fs.mkdirSync(SHOTS, { recursive: true })
let mock: any
test.beforeAll(async () => { mock = await startMockServer() })
test.afterAll(async () => { dumpMockTimings('r2b', mock); await mock.close() })
let app: ElectronApplication, page: Page
test.afterEach(async ({}, info) => {
  if (page && info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  await app?.close().catch(() => {})
})
const now = Date.now()
const M = (id: string, role: string, content: string, extra: any = {}) => ({ id, role, content, createdAt: now, ...(role === 'assistant' ? { model: 'gpt-4o' } : {}), ...extra })
const C = (id: string, title: string, messages: any[], extra: any = {}) => ({ id, title, pinned: false, providerId: 'mock', model: 'gpt-4o', systemPrompt: '', createdAt: now, updatedAt: now - id.length, messages, ...extra })
const showcase = (zh: boolean) => [
  C('s1', zh ? '潮汐与月相' : 'Tides and the moon', [
    M('q1', 'user', zh ? '潮汐为什么一天两次？' : 'Why are there two tides a day?'),
    M('r1', 'assistant', zh ? '因为月球引力在地球**朝向月球的一侧**和**背向月球的一侧**各形成一个潮汐隆起，地球自转一周会经过两个隆起。\n\n- 大潮：新月、满月\n- 小潮：上弦、下弦' : 'The Moon raises one tidal bulge on the side **facing** it and one on the **far side**; Earth rotates through both bulges each day.\n\n- Spring tides: new and full moon\n- Neap tides: quarter moons', { usage: { input: 24, output: 96 } }),
  ], { folderId: 'f1', tags: [zh ? '科普' : 'science'] }),
  C('s22', zh ? '周报润色' : 'Polish weekly report', [M('x', 'user', 'hi')], { folderId: 'f1' }),
  C('s333', zh ? 'SQL 慢查询优化' : 'Slow SQL tuning', [M('y', 'user', 'hi')]),
]
const seedShow = (lang: 'zh' | 'en', theme: 'light' | 'dark', extra: any = {}) => seedUserData({ mockUrl: mock.url, language: lang, theme, conversations: showcase(lang === 'zh'),
  files: { folders: [{ id: 'f1', name: lang === 'zh' ? '学习' : 'Learning' }] }, ...extra })
const shot = (n: string, clip?: { x: number; y: number; width: number; height: number }) => page.screenshot({ path: path.join(SHOTS, n + '.png'), clip })
const openSettings = async (tab: string) => { await page.keyboard.press('Control+,'); await page.locator(`.tabs button[data-tab="${tab}"]`).click() }

/** capture the real window incl. the OS-drawn caption buttons (Linux/Xvfb via ffmpeg x11grab); falls back to the page */
async function windowShot(name: string, height = 140) {
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds())
  const out = path.join(SHOTS, name + '.png')
  if (process.platform === 'linux' && process.env.DISPLAY) {
    try {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'x11grab', '-video_size', `${b.width}x${height}`, '-i', `${process.env.DISPLAY}+${b.x},${b.y}`, '-frames:v', '1', out])
      return
    } catch { /* fall back */ }
  }
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: b.width, height } })
}

for (const [lang, theme] of [['zh', 'light'], ['zh', 'dark'], ['en', 'light'], ['en', 'dark']] as const) {
  test(`overview ${theme}-${lang}`, async () => {
    ;({ app, page } = await launch(seedShow(lang, theme)))
    await page.locator('.conv', { hasText: lang === 'zh' ? '潮汐与月相' : 'Tides and the moon' }).click()
    await expect(page.locator('.msg.assistant')).toBeVisible()
    await expect(page.getByTestId('titlebar')).toContainText(lang === 'zh' ? '潮汐与月相' : 'Tides and the moon')
    await shot(`${theme}-${lang}`)
  })
}

test('custom title bar follows the app theme (not the system accent)', async () => {
  for (const theme of ['light', 'dark'] as const) {
    ;({ app, page } = await launch(seedShow('zh', theme)))
    await page.locator('.conv').first().click()
    const tb = page.getByTestId('titlebar')
    await expect(tb).toBeVisible()
    await expect(tb.locator('.brand')).toContainText('潮笺 Tidequill')
    const bg = await tb.evaluate(e => getComputedStyle(e).backgroundColor)
    const hex = colors[theme].bgSubtle
    expect(bg).toBe(`rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`)
    expect(await tb.evaluate(e => getComputedStyle(e).getPropertyValue('-webkit-app-region') || (e.style as any).webkitAppRegion)).toContain('drag')
    // the native window-controls overlay is recolored by main when the theme changes
    if (process.platform !== 'darwin') expect(await page.evaluate(d => (window as any).api.setTitleBarTheme(d), theme === 'dark')).toBe(true)
    await windowShot(`titlebar-${theme}`)
    await app.close()
  }
})

test('provider settings: status badges, key show/hide, test connection, chips, saved feedback, delete confirm', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, settings: { providers: [
    { id: 'mock', name: 'Mock', type: 'openai', apiKey: 'sk-mock-123456', baseURL: mock.url, models: ['mock-ok', 'mock-slow', 'gpt-4o-mock'] },
    { id: 'down', name: 'Down', type: 'openai', apiKey: 'sk-down', baseURL: 'http://127.0.0.1:9/v1', models: ['x'] },
    { id: 'nokey', name: 'NoKey', type: 'openai', apiKey: '', baseURL: mock.url, models: [] },
  ] } })))
  await openSettings('providers')
  await expect(page.getByTestId('badge-mock')).toHaveAttribute('data-state', 'ok', { timeout: 10_000 })
  await expect(page.getByTestId('badge-down')).toHaveAttribute('data-state', 'fail', { timeout: 10_000 })
  await expect(page.getByTestId('badge-nokey')).toHaveAttribute('data-state', 'nokey')
  expect(await page.getByTestId('badge-down').getAttribute('data-tip')).toContain(zhCN.provFail)
  // saved key: shown only as 已保存 (never the value), 替换 opens an empty field with show / hide while typing
  await expect(page.getByTestId('api-key-state')).toHaveText(zhCN.secretSaved)
  await expect(page.locator('.modal')).not.toContainText('sk-mock-123456')
  await page.getByTestId('api-key-replace').click()
  const key = page.getByTestId('api-key')
  await expect(key).toHaveValue('')
  await expect(key).toHaveAttribute('type', 'password')
  await page.getByTestId('api-key-toggle').click()
  await expect(key).toHaveAttribute('type', 'text')
  await page.getByTestId('api-key-cancel').click()
  await expect(page.getByTestId('api-key-state')).toBeVisible()
  // test connection -> success inline
  await page.getByTestId('test-conn').click()
  await expect(page.getByTestId('test-result')).toContainText(zhCN.provOkTip.split('{n}')[0])
  // chips: search, uncheck (hidden from selector), add, remove
  await page.getByTestId('model-filter').fill('slow')
  await expect(page.locator('.mchip')).toHaveCount(1)
  await page.getByTestId('model-filter').fill('')
  // the "saved" flag is transient (2.5 s); on a slow Windows runner it could be gone before the first poll.
  // assert the persistent save counter instead, and the flag only in its rendered form
  const before = Number(await page.getByTestId('settings-title').getAttribute('data-save-count'))
  await page.locator('.mchip[data-model="mock-slow"] input').uncheck()
  await expect(page.getByTestId('settings-title')).toHaveAttribute('data-save-count', String(before + 1))
  await page.getByTestId('model-add').fill('my-new-model'); await page.getByTestId('model-add').press('Enter')
  await expect(page.locator('.mchip[data-model="my-new-model"]')).toBeVisible()
  await page.getByRole('button', { name: `${zhCN.removeModel} gpt-4o-mock` }).click()
  await expect(page.locator('.mchip[data-model="gpt-4o-mock"]')).toHaveCount(0)
  await page.getByTestId('model-chips').scrollIntoViewIfNeeded()
  await page.locator('.pitem', { hasText: 'Down' }).locator('.sbadge').hover()
  await shot('provider-badge-tooltip')
  await page.locator('.pitem', { hasText: 'Mock' }).click()
  await expect(page.getByTestId('api-key-state')).toHaveText(zhCN.secretSaved)
  await page.getByTestId('test-conn').click()
  await expect(page.getByTestId('test-result')).toContainText(zhCN.provOkTip.split('{n}')[0])
  await page.locator('.mchip[data-model="mock-ok"]').hover()
  await shot('provider-settings')
  // failure reason inline
  await page.locator('.pitem', { hasText: 'Down' }).click()
  await page.getByTestId('test-conn').click()
  await expect(page.getByTestId('test-result')).toHaveClass(/errmsg/)
  await expect(page.getByTestId('test-result')).toContainText(zhCN.err_network)
  await shot('provider-test-fail')
  // delete needs confirmation: dismiss keeps it, accept removes it
  page.once('dialog', d => d.dismiss())
  await page.getByTestId('delete-provider').click()
  await expect(page.locator('.pitem', { hasText: 'Down' })).toHaveCount(1)
  page.once('dialog', d => d.accept())
  await page.getByTestId('delete-provider').click()
  await expect(page.locator('.pitem', { hasText: 'Down' })).toHaveCount(0)
  await expect(page.getByTestId('default-model')).toContainText(zhCN.defaultModelRule)
  // hidden model is not offered in the selector
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  await page.locator('.modelbtn').click()
  await expect(page.locator('.modelopt', { hasText: 'mock-slow' })).toHaveCount(0)
  await expect(page.locator('.modelopt', { hasText: 'my-new-model' })).toHaveCount(1)
})

test('sidebar: grouped toolbox, no import/export, empty folder guidance, shortcut tooltips', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, conversations: [C('a', '第一个对话', [M('u', 'user', 'hi')])] })))
  await expect(page.getByTestId('folders-empty')).toContainText(zhCN.foldersEmpty.slice(0, 6))
  await expect(page.getByTestId('nav-tools').locator('button')).toHaveCount(4)
  await expect(page.locator('.sidenav')).not.toContainText(zhCN.importData)
  await expect(page.locator('.sidenav')).not.toContainText(zhCN.exportJson)
  await page.locator('.conv').first().click()
  for (const [label, sc] of [[zhCN.convSettings, 'Shift+S'], [zhCN.exportAs, '+E'], [zhCN.systemPrompt, 'Shift+P']]) {
    expect(await page.getByRole('button', { name: label, exact: true }).getAttribute('title')).toContain(sc)
  }
  expect(await page.getByRole('button', { name: zhCN.reasoning, exact: true }).getAttribute('data-tip')).toContain('+D')
  // shortcuts work
  await page.keyboard.press('Control+d')
  await expect(page.getByRole('button', { name: zhCN.reasoning, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Control+Shift+S')
  await expect(page.getByRole('dialog', { name: zhCN.convSettings })).toBeVisible()
  await page.keyboard.press('Escape')
  await shot('sidebar-grouping', { x: 0, y: 0, width: 280, height: (page.viewportSize()?.height || 800) })
  // import/export are in Settings > Data with distinct icons
  await openSettings('data')
  await expect(page.getByTestId('import-data')).toBeVisible(); await expect(page.getByTestId('export-all')).toBeVisible()
  const icons = await Promise.all(['import-data', 'export-all', 'backup', 'restore'].map(id => page.getByTestId(id).locator('svg').getAttribute('class')))
  expect(new Set(icons).size).toBe(4)
  await page.keyboard.press('Escape')
  await page.locator('.sidebar').hover()
  await shot('empty-folders', { x: 0, y: 0, width: 280, height: 260 })
})

test('reading width: narrow / standard / wide; actions shown on hover', async () => {
  const long = '潮水每天涨落两次，'.repeat(40)
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, conversations: [C('w', '阅读宽度', [M('u', 'user', '写一段长文'), M('a', 'assistant', long)])] })))
  // Windows CI 的屏幕工作区较小，窗口会被系统限制在约 1024 px 宽，导致 980 / 1280 两档的实际宽度都被可用宽度截断。
  // 先尝试把窗口放大；同时直接检查计算后的 max-width，这样不受屏幕大小影响。
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(1700, 1000) })
  await page.locator('.conv').first().click()
  const width = () => page.locator('.msg.assistant').first().evaluate(e => e.getBoundingClientRect().width)
  const maxW = () => page.locator('.msg.assistant').first().evaluate(e => getComputedStyle(e).maxWidth)
  expect(await maxW()).toBe('980px')
  const w0 = await width()
  const acts = page.locator('.msg.assistant .msgacts').first()
  await page.locator('.composer textarea').hover()
  await expect(acts).toHaveCSS('opacity', '0')
  await page.locator('.msg.assistant').first().hover()
  await expect(acts).toHaveCSS('opacity', '1')
  const widths: Record<string, number> = {}
  for (const w of ['narrow', 'wide'] as const) {
    await openSettings('chat')
    await page.locator(`.seg button[data-width="${w}"]`).click()
    await page.keyboard.press('Escape')
    widths[w] = await width()
    expect(await maxW()).toBe(w === 'narrow' ? '720px' : '1280px')
    await page.locator('.composer textarea').hover()
    await shot(`reading-width-${w}`)
  }
  expect(widths.narrow).toBeLessThan(w0)
  // 只有窗口实际宽于 980 px 时，“宽”才可能比“标准”更宽
  const avail = await page.locator('.messages, .chat').first().evaluate(e => e.clientWidth)
  if (avail > 1000) expect(widths.wide).toBeGreaterThan(w0)
  else expect(widths.wide).toBeGreaterThanOrEqual(w0)
})

test('context usage indicator: estimate vs model window, warning near / over the limit', async () => {
  const para = '这是一段用于测试上下文用量的较长文本，'.repeat(20) // ≈ 400 tokens
  const msgs = Array.from({ length: 8 }, (_, i) => M('m' + i, i % 2 ? 'assistant' : 'user', para, i % 2 ? { model: 'mock-ok' } : {}))
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, settings: { contextWindows: [{ pattern: 'mock', tokens: 3600 }] },
    conversations: [C('c', '长对话', msgs, { model: 'mock-ok' }), C('c2', '短对话', [M('s', 'user', 'hi')], { model: 'unknown-model-x' })] })))
  await page.locator('.conv', { hasText: '长对话' }).click()
  const bar = page.getByTestId('ctx-usage')
  await expect(bar).toHaveAttribute('data-level', 'near')
  await expect(page.getByTestId('ctx-warn')).toHaveText(zhCN.ctxNearShort)
  expect(await bar.getAttribute('title')).toContain('3,600')
  await shot('context-near-limit')
  // typing pushes it over the window
  await page.locator('.composer textarea').fill(para.repeat(3))
  await expect(bar).toHaveAttribute('data-level', 'over')
  await expect(page.getByTestId('ctx-warn')).toHaveText(zhCN.ctxOverShort)
  await shot('context-over-limit')
  // fewer context messages -> lower usage
  await page.locator('.composer textarea').fill('')
  const used = async () => Number(await bar.getAttribute('aria-valuenow'))
  const before = await used()
  await page.getByRole('button', { name: zhCN.convSettings, exact: true }).click()
  await page.locator('[data-param="contextLength"]').fill('2')
  await page.getByRole('button', { name: zhCN.save, exact: true }).click()
  await expect.poll(used).toBeLessThan(before / 2)
  // unknown model: no denominator, explained in tooltip
  await page.locator('.conv', { hasText: '短对话' }).click()
  await expect(bar).toHaveAttribute('data-level', 'unknown')
  await expect(bar).toContainText(zhCN.ctxUnknownWindow)
})

test('english strings for stage B controls', async () => {
  for (const k of ['navTools', 'foldersEmpty', 'readingWidth', 'ctxLabel', 'provOk', 'defaultModelRule', 'savedFlag'] as const) expect(en[k]).toBeTruthy()
})
