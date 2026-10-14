// Round 2 stage C: web search + citations, xlsx/pptx/OCR attachments, oversized files, sandboxed HTML/SVG preview,
// multi-model compare, find in conversation, voice input (OpenAI-compatible STT)
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, seedUserData, send, dumpMockTimings, httpLogFile } from './helpers'
// @ts-ignore
import { startMockServer, SEARCH_RESULTS, CITED_REPLY, TRANSCRIPT, COMPARE_REPLIES } from '../tests/mock-server.mjs'
import { zhCN } from '../src/renderer/locales/zh-CN'
import { en } from '../src/renderer/locales/en'

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'r2-C')
const FIX = path.resolve(__dirname, '..', 'tests', 'fixtures')
fs.mkdirSync(SHOTS, { recursive: true })
let mock: any
test.beforeAll(async () => { mock = await startMockServer(0, { ocrDir: path.join(FIX, 'ocr') }) })
test.afterAll(async () => { dumpMockTimings('r2c', mock); await mock.close() })
let app: ElectronApplication, page: Page
test.afterEach(async ({}, info) => {
  if (page && info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  await app?.close().catch(() => {})
})
const base = () => mock.url.replace(/\/v1$/, '')
const now = Date.now()
const M = (id: string, role: string, content: string, extra: any = {}) => ({ id, role, content, createdAt: now, ...(role === 'assistant' ? { model: 'mock-ok' } : {}), ...extra })
const C = (id: string, title: string, messages: any[], extra: any = {}) => ({ id, title, pinned: false, providerId: 'mock', model: 'mock-ok', systemPrompt: '', createdAt: now, updatedAt: now - id.length, messages, ...extra })
const cites = SEARCH_RESULTS.map((r: any, i: number) => ({ n: i + 1, title: r.title, url: r.url, snippet: r.content }))
const shot = (n: string) => page.screenshot({ path: path.join(SHOTS, n + '.png') })
const openSettings = async (tab: string) => { await page.keyboard.press('Control+,'); await page.locator(`.tabs button[data-tab="${tab}"]`).click() }
const searchCfg = (p: any = {}) => ({ enabled: false, provider: 'tavily', maxResults: 3, tavilyKey: '', bingKey: '', braveKey: '', searxngUrl: '', endpoints: { tavily: base() + '/search/tavily', bing: base() + '/bing/v7.0/search', brave: base() + '/brave/res/v1/web/search' }, ...p })
const lastUserText = () => { const ms = mock.requests.at(-1)?.messages || []; return String(ms.filter((m: any) => m.role === 'user').at(-1)?.content ?? '') }
const contentOf = (m: any) => typeof m.content === 'string' ? m.content : (m.content || []).map((p: any) => p.text || '').join('')

const showcase = (zh: boolean) => [
  C('c1', zh ? '潮汐为什么一天两次' : 'Why two tides a day', [
    M('q1', 'user', zh ? '潮汐为什么一天两次？' : 'Why are there two tides a day?'),
    M('r1', 'assistant', zh ? CITED_REPLY : 'Tides are mainly caused by the Moon\'s gravity [1]; most coasts see two high and two low tides each day [2]. There is one tidal bulge on each side of the Earth [3].',
      { citations: cites, searchQuery: zh ? '潮汐为什么一天两次？' : 'Why are there two tides a day?', usage: { input: 320, output: 64 } }),
  ]),
  C('c22', zh ? '季度销售表格分析' : 'Quarterly sales sheet', [M('x', 'user', 'hi')]),
  C('c333', zh ? '登录页 HTML 草稿' : 'Login page HTML draft', [M('y', 'user', 'hi')]),
]

for (const [lang, theme] of [['zh', 'light'], ['zh', 'dark'], ['en', 'light'], ['en', 'dark']] as const) {
  test(`overview ${theme}-${lang}`, async () => {
    ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, language: lang, theme, conversations: showcase(lang === 'zh'), settings: { webSearch: searchCfg({ enabled: true, tavilyKey: 'tvly-x' }) } })))
    await page.locator('.conv').first().click()
    await expect(page.locator('a.cite')).toHaveCount(3)
    await expect(page.getByTestId('search-toggle')).toHaveAttribute('aria-pressed', 'true')
    await shot(`${theme}-${lang}`)
  })
}

test('web search: settings, key encrypted on disk, toolbar toggle, request via main process, citations link to sources', async () => {
  const ud = seedUserData({ mockUrl: mock.url, conversations: [C('w', '联网', [])], settings: { webSearch: searchCfg() } })
  ;({ app, page } = await launch(ud))
  await page.locator('.conv').first().click()
  // settings: provider, key (show/hide), test search
  await openSettings('searchTab')
  await page.locator('.seg button[data-provider="bing"]').click()
  await expect(page.getByTestId('bing-note')).toContainText('2025-08-11')
  await page.locator('.seg button[data-provider="tavily"]').click()
  await page.getByTestId('search-key').fill('tvly-e2e-secret')
  await expect(page.getByTestId('search-key')).toHaveAttribute('type', 'password')
  await page.getByTestId('search-test').click()
  await expect(page.getByTestId('search-test-result')).toContainText(zhCN.searchTestOk.replace('{n}', '3'))
  await page.keyboard.press('Escape')
  // key never stored in plain text
  const secure = await page.evaluate(() => (window as any).api.secureStatus())
  if (secure.available || process.env.EXPECT_SAFE_STORAGE) {
    await expect.poll(() => fs.readFileSync(path.join(ud, 'data', 'settings.json'), 'utf8')).toContain('"tavilyKey":"enc:v1:')
    expect(fs.readFileSync(path.join(ud, 'data', 'settings.json'), 'utf8')).not.toContain('tvly-e2e-secret')
  }
  // toolbar toggle on -> search before the reply
  const toggle = page.getByTestId('search-toggle')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const n0 = mock.searches.length
  await send(page, '潮汐为什么一天两次？')
  const reply = page.locator('.msg.assistant').last()
  await expect(reply.locator('a.cite')).toHaveCount(3)
  expect(mock.searches.length).toBe(n0 + 1)
  expect(mock.searches.at(-1)).toMatchObject({ provider: 'tavily', query: '潮汐为什么一天两次？', auth: 'Bearer tvly-e2e-secret' })
  // the model received the results, the stored message did not
  expect(lastUserText()).toContain('<web_search>'); expect(lastUserText()).toContain(SEARCH_RESULTS[1].url)
  await expect(page.locator('.msg.user .usertext').last()).toHaveText('潮汐为什么一天两次？')
  // citation markers and the source list link to the real URLs
  await expect(reply.locator('a.cite[data-cite="2"]')).toHaveAttribute('href', SEARCH_RESULTS[1].url)
  await expect(reply.locator('a.cite[data-cite="1"]')).toHaveAttribute('target', '_blank')
  await expect(reply.getByTestId('sources').locator('li')).toHaveCount(3)
  await expect(reply.getByTestId('sources').locator('a').nth(2)).toHaveAttribute('href', SEARCH_RESULTS[2].url)
  // the search request was made by the main process (bridge log), the renderer itself has no network access (CSP)
  const log = fs.readFileSync(httpLogFile(ud), 'utf8')
  expect(log).toContain('/search/tavily')
  const direct = await page.evaluate(u => fetch(u).then(() => 'ok', e => 'blocked: ' + e.message), base() + '/searxng/search?q=x&format=json')
  expect(direct).toContain('blocked')
  await reply.hover()
  await page.locator('a.cite[data-cite="1"]').last().hover()
  await shot('web-search-citations')
  // failure is reported and the reply still arrives without results
  await openSettings('searchTab')
  await page.locator('.seg button[data-provider="brave"]').click()
  await page.keyboard.press('Escape')
  await send(page, '再问一次')
  await expect(page.locator('.msg.assistant').last().getByTestId('search-error')).toContainText(zhCN.searchErr_nokey)
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock')
})

test('attachments: PDF text extraction (pdf.js worker, all pages)', async () => {
  const ud = seedUserData({ mockUrl: mock.url, conversations: [C('a', 'PDF', [])] })
  ;({ app, page } = await launch(ud))
  await page.locator('.conv').first().click()
  await page.locator('.composer input[type=file]').setInputFiles([path.join(FIX, 'sample.pdf')])
  await expect(page.locator('.pending .filechip[data-kind=pdf]')).toContainText('sample.pdf')
  await page.locator('.composer textarea').fill('read the pdf')
  await page.locator('.composer textarea').press('Enter')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock')
  const sent = contentOf(mock.requests.at(-1).messages.at(-1))
  expect(sent).toContain('<file name="sample.pdf">'); expect(sent).toContain('Tidequill PDF fixture page one'); expect(sent).toContain('Second page: tides 42')
})

test('attachments: xlsx / pptx text extraction, oversized and legacy files get a clear message', async () => {
  const ud = seedUserData({ mockUrl: mock.url, conversations: [C('a', '附件', [])], settings: { maxAttachmentMB: 1 } })
  ;({ app, page } = await launch(ud))
  await page.locator('.conv').first().click()
  const input = page.locator('.composer input[type=file]')
  await input.setInputFiles([path.join(FIX, 'sample.xlsx'), path.join(FIX, 'sample.pptx')])
  await expect(page.locator('.pending .filechip[data-kind=xlsx]')).toContainText('sample.xlsx')
  await expect(page.locator('.pending .filechip[data-kind=pptx]')).toContainText('sample.pptx')
  await page.locator('.composer textarea').fill('总结这两个文件')
  await shot('attachment-xlsx-pptx')
  await page.locator('.composer textarea').press('Enter')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock')
  const sent = contentOf(mock.requests.at(-1).messages.at(-1))
  expect(sent).toContain('<file name="sample.xlsx">'); expect(sent).toContain('华南\t98\t110.5'); expect(sent).toContain('## 季度销售')
  expect(sent).toContain('<file name="sample.pptx">'); expect(sent).toContain('潮笺 季度回顾'); expect(sent).toContain('新增用户 3.4 万')
  // oversized: limit from settings, size and file name in the message, nothing added
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-big-'))
  const big = path.join(tmp, 'huge-log.txt'); fs.writeFileSync(big, Buffer.alloc(2_300_000, 97))
  const legacy = path.join(tmp, 'old.xls'); fs.writeFileSync(legacy, 'x')
  await input.setInputFiles([big, legacy])
  const warn = page.getByTestId('att-warning')
  await expect(warn).toContainText(zhCN.attTooLarge.replace('{name}', 'huge-log.txt').replace('{size}', '2.2 MB').replace('{limit}', '1 MB'))
  await expect(warn).toContainText(zhCN.attUnsupported.replace('{name}', 'old.xls'))
  await expect(page.locator('.pending .filechip')).toHaveCount(0)
  await shot('oversized-warning')
  await warn.getByRole('button', { name: zhCN.dismiss }).click()
  await expect(warn).toHaveCount(0)
})

test('OCR (optional): off by default, language data downloaded through main, text recognized locally', async () => {
  test.setTimeout(120_000)
  const ud = seedUserData({ mockUrl: mock.url, conversations: [C('o', 'OCR', [])], settings: { ocr: { enabled: false, langs: ['eng'], source: base() + '/ocr/{lang}.traineddata.gz' } } })
  ;({ app, page } = await launch(ud))
  await page.locator('.conv').first().click()
  const input = page.locator('.composer input[type=file]')
  // off: an image is only an image
  await input.setInputFiles(path.join(FIX, 'ocr-sample.png'))
  await expect(page.locator('.pending .thumb')).toHaveCount(1)
  await expect(page.locator('.pending .filechip')).toHaveCount(0)
  await page.locator('.pending .thumb .remove').click()
  await openSettings('chat')
  await page.getByTestId('ocr-enabled').check()
  await expect(page.getByTestId('ocr-state-eng')).toHaveText(zhCN.ocrMissing)
  await page.keyboard.press('Escape')
  // enabled but no data yet -> clear message
  await input.setInputFiles(path.join(FIX, 'ocr-sample.png'))
  await expect(page.getByTestId('att-warning')).toContainText(zhCN.ocrNeedData)
  await page.getByTestId('att-warning').getByRole('button').click()
  await page.locator('.pending .thumb .remove').click()
  await openSettings('chat')
  await page.getByTestId('ocr-dl-eng').click()
  await expect(page.getByTestId('ocr-state-eng')).toContainText(zhCN.ocrDownloaded.replace('{size}', '2.8 MB'))
  expect(fs.existsSync(path.join(ud, 'ocr', 'eng.traineddata.gz'))).toBe(true)
  await page.keyboard.press('Escape')
  await input.setInputFiles(path.join(FIX, 'ocr-sample.png'))
  const chip = page.locator('.pending .filechip[data-kind=ocr]')
  await expect(chip).toBeVisible({ timeout: 90_000 })
  await page.locator('.composer textarea').fill('图里写了什么？')
  await page.locator('.composer textarea').press('Enter')
  await expect(page.locator('.msg.assistant').last()).toContainText('Hello from mock')
  const sent = contentOf(mock.requests.at(-1).messages.at(-1))
  expect(sent.toUpperCase()).toContain('TIDEQUILL OCR TEST')
})

const ATTACK = `<!doctype html><html><head><title>probe</title></head><body><h1 id="h">Sandbox probe</h1><pre id="out" style="white-space:pre-wrap;font-size:12px">running</pre><script>
const r = {};
const t = (k, f) => { try { r[k] = String(f()); } catch (e) { r[k] = 'blocked:' + e.name; } };
t('parentDoc', () => window.parent.document.title);
t('topDoc', () => window.top.document.body.innerHTML.length);
t('parentApi', () => typeof window.parent.api);
t('ownApi', () => typeof window.api);
t('require', () => typeof require);
t('process', () => typeof process);
t('ipc', () => typeof window.ipcRenderer);
t('electron', () => typeof window.electron);
t('origin', () => self.origin);
t('cookie', () => document.cookie);
t('storage', () => localStorage.length);
t('opener', () => { const w = window.open('https://example.com'); return w === null ? 'null' : 'opened'; });
t('topNav', () => { window.top.location.href = 'https://example.com'; return 'navigated'; });
fetch('MOCK/search/tavily').then(() => { r.fetch = 'ok'; done(); }, e => { r.fetch = 'blocked:' + e.name; done(); });
function done() { document.getElementById('out').textContent = JSON.stringify(r); }
</script></body></html>`

test('HTML / SVG preview: sandboxed iframe, CSP, script cannot reach the parent, window.api, IPC or the network', async () => {
  const html = ATTACK.replace('MOCK', base())
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="90"><rect x="5" y="5" width="210" height="80" rx="12" fill="#2563eb"/><text x="110" y="55" fill="#fff" font-size="24" text-anchor="middle">Tidequill</text><script>parent.document.title="pwned"</script></svg>'
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, conversations: [C('h', '预览', [
    M('u', 'user', '写一个页面'), M('a', 'assistant', 'HTML：\n\n```html\n' + html + '\n```\n\nSVG：\n\n```svg\n' + svg + '\n```')])] })))
  await page.locator('.conv').first().click()
  const n0 = mock.searches.length
  const btns = page.getByTestId('preview-btn')
  await expect(btns).toHaveCount(2)
  await btns.first().click()
  const frameEl = page.getByTestId('html-preview').first().locator('iframe')
  await expect(frameEl).toHaveAttribute('sandbox', 'allow-scripts')
  expect(await frameEl.getAttribute('src')).toMatch(/^tqpreview:\/\/p\/[0-9a-f-]{36}$/)
  const out = page.frameLocator('[data-testid=html-preview] iframe').first().locator('#out')
  await expect(out).not.toHaveText('running', { timeout: 10_000 })
  const r = JSON.parse(await out.textContent() || '{}')
  expect(r.parentDoc).toBe('blocked:SecurityError')
  expect(r.topDoc).toBe('blocked:SecurityError')
  expect(r.parentApi).toBe('blocked:SecurityError')
  expect(r.ownApi).toBe('undefined'); expect(r.require).toBe('undefined'); expect(r.process).toBe('undefined')
  expect(r.ipc).toBe('undefined'); expect(r.electron).toBe('undefined')
  expect(r.origin).toBe('null')
  expect(r.cookie).toMatch(/^blocked:/); expect(r.storage).toMatch(/^blocked:/)
  expect(r.opener).toBe('null')
  expect(r.topNav).toMatch(/^blocked:/)
  expect(r.fetch).toMatch(/^blocked:/)
  expect(mock.searches.length).toBe(n0) // nothing reached the network
  // the app is untouched and the iframe content is not reachable from the app either (cross-origin)
  expect(await page.evaluate(() => document.title)).toBe('Tidequill')
  expect(await frameEl.evaluate((f: HTMLIFrameElement) => f.contentDocument)).toBeNull()
  expect(page.url()).toMatch(/^file:/)
  // the document carries the CSP both as header and as <meta>
  const meta = await page.frameLocator('[data-testid=html-preview] iframe').first().locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(meta).toContain("default-src 'none'"); expect(meta).toContain("form-action 'none'")
  // SVG preview: rendered, its script cannot touch the app either
  await btns.nth(1).click()
  await expect(page.getByTestId('html-preview')).toHaveCount(2)
  await expect(page.frameLocator('[data-testid=html-preview] iframe').nth(1).locator('svg text')).toHaveText('Tidequill')
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => document.title)).toBe('Tidequill')
  await page.getByTestId('html-preview').first().scrollIntoViewIfNeeded()
  await shot('html-preview')
})

test('multi-model compare: parallel replies side by side, chosen answer stays in context', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, model: 'cmp-a', conversations: [C('m', '对比', [], { model: 'cmp-a' })],
    settings: { providers: [{ id: 'mock', name: 'Mock', type: 'openai', apiKey: 'sk-x', baseURL: mock.url, models: ['cmp-a', 'cmp-b', 'cmp-c', 'mock-ok'] }] } })))
  await page.locator('.conv').first().click()
  await page.getByTestId('compare-btn').click()
  const bar = page.getByTestId('compare-bar')
  for (const m of ['cmp-b', 'cmp-c']) {
    await bar.locator('.compare-add .modelbtn').click()
    await bar.locator('.compare-add .modelsearch input').fill(m)
    await bar.locator('.compare-add .modelsearch input').press('Enter')
    await expect(bar.locator(`.mchip[data-model="${m}"]`)).toBeVisible()
  }
  await expect(bar).toContainText(zhCN.compareCount.replace('{n}', '3'))
  await send(page, '潮汐为什么一天两次？')
  const grid = page.getByTestId('compare-grid')
  await expect(grid.locator('.msg')).toHaveCount(3)
  for (const [m, txt] of Object.entries(COMPARE_REPLIES)) await expect(grid.locator(`.msg[data-model="${m}"]`)).toContainText(txt as string)
  // all three requests were in flight at the same time (parallel), one per model
  const reqs = mock.requests.slice(-3).map((r: any) => r.model).sort()
  expect(reqs).toEqual(['cmp-a', 'cmp-b', 'cmp-c'])
  await expect(grid.locator('.msg.chosen')).toHaveAttribute('data-model', 'cmp-a')
  await grid.locator('.msg[data-model="cmp-b"]').getByTestId('compare-choose').click()
  await expect(grid.locator('.msg.chosen')).toHaveAttribute('data-model', 'cmp-b')
  await shot('multi-model-compare')
  // next turn: only the chosen answer is in the history
  await bar.getByRole('button', { name: zhCN.compareOff }).click()
  await send(page, '继续')
  await expect(page.locator('.msg.assistant').last()).toContainText(COMPARE_REPLIES['cmp-a'])
  const hist = mock.requests.at(-1).messages.map(contentOf).join('\n')
  expect(hist).toContain(COMPARE_REPLIES['cmp-b']); expect(hist).not.toContain(COMPARE_REPLIES['cmp-c']); expect(hist).not.toContain('潮汐每天两次')
})

test('find in conversation (Ctrl+F): highlight, count, next / previous, Esc', async () => {
  const msgs = [] as any[]
  for (let i = 0; i < 6; i++) msgs.push(M('u' + i, 'user', `第 ${i + 1} 个问题：潮汐和月亮有什么关系？`), M('a' + i, 'assistant', `回答 ${i + 1}：潮汐主要由月球引力引起，**潮汐**每天两次。Tide note ${i + 1}.`))
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, conversations: [C('f', '查找', msgs)] })))
  await page.locator('.conv').first().click()
  await page.keyboard.press('Control+f')
  const bar = page.getByTestId('findbar')
  await expect(bar.locator('input')).toBeFocused()
  await bar.locator('input').fill('潮汐')
  const count = bar.getByTestId('find-count')
  await expect(count).toHaveText('1/18')
  const hl = () => page.evaluate(() => [(CSS as any).highlights.get('tq-find')?.size, (CSS as any).highlights.get('tq-find-cur')?.size])
  expect(await hl()).toEqual([17, 1])
  await bar.locator('input').press('Enter'); await expect(count).toHaveText('2/18')
  await bar.locator('input').press('Shift+Enter'); await bar.locator('input').press('Shift+Enter'); await expect(count).toHaveText('18/18')
  await bar.getByRole('button', { name: zhCN.findNext }).click(); await expect(count).toHaveText('1/18')
  // case-insensitive
  await bar.locator('input').fill('TIDE'); await expect(count).toHaveText('1/6')
  for (let i = 0; i < 3; i++) await bar.locator('input').press('Enter')
  await expect(count).toHaveText('4/6')
  // the current match is scrolled into view
  const vis = await page.evaluate(() => { const r = (CSS as any).highlights.get('tq-find-cur'); const range = [...r][0] as Range; const b = range.getBoundingClientRect(); const l = document.querySelector('.messages')!.getBoundingClientRect(); return b.top >= l.top && b.bottom <= l.bottom })
  expect(vis).toBe(true)
  await shot('find-highlight')
  await bar.locator('input').fill('不存在的词'); await expect(count).toHaveText(zhCN.findNone)
  await bar.locator('input').press('Escape')
  await expect(bar).toHaveCount(0)
  expect(await hl()).toEqual([undefined, undefined])
})

test('voice input: mic only after the button armed it, audio sent to /audio/transcriptions, text inserted', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, conversations: [C('v', '语音', [])], settings: { stt: { enabled: true, providerId: 'mock', model: 'whisper-1', language: 'zh' } } }),
    {}, ['--use-fake-device-for-media-stream']))
  await page.locator('.conv').first().click()
  // a page script calling getUserMedia on its own is denied (permission handler)
  const direct = await page.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { s.getTracks().forEach(t => t.stop()); return 'granted' }, e => e.name))
  expect(direct).toBe('NotAllowedError')
  // video is never granted, even right after arming
  const video = await page.evaluate(async () => { await (window as any).api.armMic(); return navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'granted', e => e.name) })
  expect(video).toBe('NotAllowedError')
  await page.waitForTimeout(50)
  const mic = page.getByTestId('mic-btn')
  await mic.click()
  await expect(page.getByTestId('rec-bar')).toHaveAttribute('data-state', 'rec')
  await page.waitForTimeout(1600)
  await expect(page.getByTestId('rec-bar')).toContainText(zhCN.voiceRecording.replace('{s}', '1'))
  await shot('voice-input')
  await page.getByTestId('mic-btn').click()
  await expect(page.locator('.composer textarea')).toHaveValue(TRANSCRIPT)
  const tr = mock.transcriptions.at(-1)
  expect(tr).toMatchObject({ contentType: 'multipart/form-data', model: 'whisper-1', language: 'zh', auth: 'Bearer sk-plaintext-e2e' })
  expect(tr.fileType).toMatch(/^audio\/(webm|ogg)/); expect(tr.fileBytes).toBeGreaterThan(1000)
  // the permission is not left open: a later direct request is denied again
  const again = await page.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'granted', e => e.name))
  expect(again).toBe('NotAllowedError')
})

test('english strings for stage C controls', async () => {
  expect(en.webSearch).toBe('Web search'); expect(en.find).toBe('Find in conversation'); expect(en.compare).toBe('Compare models')
  expect(en.attTooLarge).toContain('{limit}'); expect(en.preview).toBe('Preview'); expect(en.voiceStart).toBe('Start recording')
  for (const k of Object.keys(zhCN)) expect((en as any)[k], k).toBeTruthy()
})
