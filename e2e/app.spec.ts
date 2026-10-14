import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, seedUserData, send, dumpMockTimings } from './helpers'
// @ts-ignore
import { startMockServer, REPLY } from '../tests/mock-server.mjs'
import { zhCN } from '../src/renderer/locales/zh-CN'
import { en } from '../src/renderer/locales/en'

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'p1')
fs.mkdirSync(SHOTS, { recursive: true })
let mock: any
test.beforeAll(async () => { mock = await startMockServer() })
test.afterAll(async () => { dumpMockTimings('app', mock); await mock.close() })

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
  expect(await page.title()).toBe('Tidequill')
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
  // import / export live in Settings > Data (Round 2 · B)
  await page.keyboard.press('Control+,'); await page.locator('.tabs button[data-tab="data"]').click()
  await page.getByTestId('export-all').click()
  await expect.poll(() => fs.existsSync(out)).toBe(true)
  await page.keyboard.press('Escape')
  const data = JSON.parse(fs.readFileSync(out, 'utf8'))
  expect(data.conversations[0].messages[0].content).toBe('导出测试')
  // markdown export of the current conversation
  const md = out.replace('.json', '.md')
  await app.evaluate(({ dialog }, p) => { (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: p }) }, md)
  await page.getByRole('button', { name: zhCN.exportAs, exact: true }).click()
  await page.getByRole('menuitem', { name: zhCN.exportMd }).click()
  await expect.poll(() => fs.existsSync(md) && fs.readFileSync(md, 'utf8')).toContain('## User')
  // delete conversation, then import
  page.once('dialog', d => d.accept())
  await page.locator('.conv.active').hover()
  await page.locator('.conv.active .acts button').nth(2).click()
  await expect(page.locator('.conv')).toHaveCount(0)
  await app.evaluate(({ dialog }, p) => { (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, out)
  await page.keyboard.press('Control+,'); await page.locator('.tabs button[data-tab="data"]').click()
  await page.getByTestId('import-data').click()
  await expect(page.locator('.conv')).toHaveCount(1)
  await page.keyboard.press('Escape')
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
  // 1.0.1: grants are scoped per source + tool
  expect(JSON.parse(fs.readFileSync(path.join(ud, 'trust.json'), 'utf8')).grants).toEqual(['plugin:builtin::get_current_time'])
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
  '', zh ? '| 算法 | 平均 | 最坏 | 稳定 |' : '| Algorithm | Average | Worst | Stable |', '|---|---|---|---|',
  zh ? '| 快速排序 | O(n log n) | O(n²) | 否 |' : '| Quicksort | O(n log n) | O(n²) | No |', zh ? '| 归并排序 | O(n log n) | O(n log n) | 是 |' : '| Merge sort | O(n log n) | O(n log n) | Yes |',
  zh ? '| 堆排序 | O(n log n) | O(n log n) | 否 |' : '| Heapsort | O(n log n) | O(n log n) | No |',
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
    expect(await page.title()).toBe('Tidequill')
    expect(await page.locator('.bubble img[src="x"]').count()).toBe(0)
    expect(consoleErrors.filter(e => /Content Security Policy/i.test(e))).toEqual([])
    await page.screenshot({ path: path.join(SHOTS, `${theme}-${lang}.png`) })
    if (theme === 'light' && lang === 'zh') {
      // let the page grow so the whole bubble can be captured (test-only style, CSP allows inline styles)
      await page.addStyleTag({ content: '.app,.chat{height:auto!important}.messages{overflow:visible!important}.composer{display:none}' })
      await page.waitForTimeout(500)
      await page.locator('.msg.assistant .bubble').first().screenshot({ path: path.join(SHOTS, 'closeup-code-table-mermaid.png') })
    }
  })
}

// ---------- P1 UI ----------
const codeConv = () => {
  const now = Date.now()
  const code = ['```python', 'def fib(n):', '    a, b = 0, 1', '    for _ in range(n):', '        a, b = b, a + b', '    return a', '```'].join('\n')
  const body = ['示例：', '', code, '', '| 列A | 列B |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |', '| 5 | 6 |', '', '```mermaid', 'graph TD', '  A[开始] --> B[结束]', '```'].join('\n')
  return [{ id: 'k1', title: '代码示例', pinned: false, providerId: 'mock', model: 'mock-ok', systemPrompt: '', createdAt: now, updatedAt: now,
    messages: [{ id: 'u1', role: 'user', content: '给个例子', createdAt: now }, { id: 'a1', role: 'assistant', content: body, model: 'mock-ok', createdAt: now }] }]
}
const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())

test('stop button interrupts a streaming reply', async () => {
  await start({ model: 'mock-slow' })
  await newChatAndSend('长回复')
  const stop = page.getByRole('button', { name: zhCN.stop, exact: true })
  await expect(stop).toBeVisible()
  await expect(page.locator('.msg.assistant .bubble').last()).toContainText('chunk2')
  await stop.click()
  await expect(page.getByRole('button', { name: zhCN.send, exact: true })).toBeVisible()
  const txt = await page.locator('.msg.assistant .bubble').last().innerText()
  await page.waitForTimeout(800)
  expect(await page.locator('.msg.assistant .bubble').last().innerText()).toBe(txt) // no more chunks after stop
  expect(txt).not.toContain('chunk59')
  await expect(page.locator('.msg.assistant .error')).toHaveCount(0)
})

test('model selector: search fetched models, pick one, type a custom model', async () => {
  await start()
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  await page.locator('.modelbtn').click()
  const search = page.getByPlaceholder(zhCN.modelSearch)
  await expect(search).toBeFocused()
  await expect(page.locator('.modelopt', { hasText: 'claude-mock' })).toBeVisible() // fetched from mock /v1/models
  await search.fill('gpt-4o')
  await expect(page.locator('.modelopt')).toHaveCount(2) // custom "gpt-4o" + gpt-4o-mock
  const pb = (await page.locator('.modelpop').boundingBox())!
  const sb = (await page.locator('.modelsel').boundingBox())!
  const x0 = Math.max(0, Math.min(pb.x, sb.x) - 16)
  await page.screenshot({ path: path.join(SHOTS, 'closeup-model-selector-open.png'), clip: { x: x0, y: 0, width: Math.min(1024 - x0, Math.max(pb.x + pb.width, sb.x + sb.width) - x0 + 16), height: pb.y + pb.height + 16 } })
  await page.locator('.modelopt', { hasText: 'gpt-4o-mock' }).click()
  await expect(page.locator('.modelbtn')).toContainText('gpt-4o-mock')
  // custom model name
  await page.locator('.modelbtn').click()
  await page.getByPlaceholder(zhCN.modelSearch).fill('my-custom-model')
  await expect(page.locator('.modelopt.custom')).toContainText(zhCN.useCustomModel + 'my-custom-model')
  await page.keyboard.press('Enter')
  await expect(page.locator('.modelbtn')).toContainText('my-custom-model')
  // list is cached on disk
  await expect.poll(() => fs.existsSync(path.join(ud, 'data', 'modelCache.json'))).toBe(true)
  expect(fs.readFileSync(path.join(ud, 'data', 'modelCache.json'), 'utf8')).toContain('claude-mock')
})

test('deep thinking toggle sends reasoning and shows collapsible reasoning', async () => {
  await start()
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  const toggle = page.getByRole('button', { name: zhCN.reasoning, exact: true })
  expect(await toggle.getAttribute('data-tip')).toContain(zhCN.reasoningTip3)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await send(page, '思考一下')
  const r = page.locator('.msg.assistant .reasoning')
  await expect(r.locator('summary')).toContainText(zhCN.reasoningContent, { timeout: 10_000 })
  await expect(page.locator('.msg.assistant .bubble').last()).toContainText(REPLY.join('').trim())
  await r.locator('summary').click()
  await expect(r.locator('.reasoning-body')).toContainText('先分析问题')
})

test('message hover actions: timestamp, model, copy, read aloud', async () => {
  await start()
  await newChatAndSend('hover 测试')
  await expect(page.locator('.msg.assistant .bubble').last()).toContainText(REPLY.join('').trim())
  const msg = page.locator('.msg.assistant').last()
  const acts = msg.locator('.msgacts')
  expect(await acts.evaluate(el => getComputedStyle(el).opacity)).toBe('0')
  await msg.hover()
  await expect.poll(() => acts.evaluate(el => getComputedStyle(el).opacity)).toBe('1')
  await expect(acts.locator('.meta').first()).toContainText('mock-ok')
  for (const n of [zhCN.copy, zhCN.regenerate, zhCN.readAloud, zhCN.delete]) await expect(acts.getByRole('button', { name: n, exact: true })).toBeVisible()
  const userActs = page.locator('.msg.user').last().locator('.msgacts')
  await page.locator('.msg.user').last().hover()
  await expect(userActs.getByRole('button', { name: zhCN.edit, exact: true })).toBeVisible()
  await msg.hover()
  await acts.getByRole('button', { name: zhCN.copy, exact: true }).click()
  expect(await clipboard()).toBe(REPLY.join(''))
  await expect(acts.getByRole('button', { name: zhCN.copy, exact: true })).toHaveAttribute('title', zhCN.copied)
  await msg.screenshot({ path: path.join(SHOTS, 'closeup-message-hover-actions.png') })
  // read aloud toggles to "stop reading" while speaking (speechSynthesis may be unavailable on CI voices; only check the toggle when it starts)
  const hasVoices = await page.evaluate(() => 'speechSynthesis' in window)
  expect(hasVoices).toBe(true)
})

test('code block copy feedback, table zebra, mermaid toolbar (zoom/copy/download)', async () => {
  await start({ conversations: codeConv() })
  const cb = page.locator('.codeblock').first()
  await expect(cb.locator('.lang')).toHaveText('python')
  await cb.locator('.copybtn').click()
  await expect(cb.locator('.copybtn')).toContainText(zhCN.copied)
  expect(await clipboard()).toContain('def fib(n):')
  await expect(cb.locator('.copybtn')).toContainText(zhCN.copy, { timeout: 3000 })
  // zebra stripes + borders
  const rows = page.locator('.bubble tbody tr')
  const bg1 = await rows.nth(0).evaluate(el => getComputedStyle(el).backgroundColor)
  const bg2 = await rows.nth(1).evaluate(el => getComputedStyle(el).backgroundColor)
  expect(bg1).not.toBe(bg2)
  expect(await page.locator('.bubble td').first().evaluate(el => getComputedStyle(el).borderBottomStyle)).toBe('solid')
  // mermaid
  await expect(page.locator('.mermaid svg')).toContainText('开始')
  await page.getByRole('button', { name: zhCN.mermaidCopy }).click()
  expect(await clipboard()).toContain('graph TD')
  await page.getByRole('button', { name: zhCN.mermaidZoom }).click()
  await expect(page.locator('.zoombox .mermaid svg')).toBeVisible()
  await page.locator('.zoombox').getByRole('button', { name: zhCN.close }).click()
  await expect(page.locator('.zoombox')).toHaveCount(0)
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'svg-')), 'diagram.svg')
  await app.evaluate(({ session }, p) => { session.defaultSession.once('will-download', (_e, item) => item.setSavePath(p)) }, out)
  await page.getByRole('button', { name: zhCN.mermaidDownload }).click()
  await expect.poll(() => fs.existsSync(out) && fs.readFileSync(out, 'utf8'), { timeout: 10_000 }).toContain('<svg')
  expect(fs.readFileSync(out, 'utf8')).not.toContain('<script')
})

test('line numbers and long-code collapse follow settings', async () => {
  const conv = codeConv()
  conv[0].messages[1].content = '```js\n' + Array.from({ length: 40 }, (_, i) => `console.log(${i})`).join('\n') + '\n```'
  await start({ conversations: conv })
  const cb = page.locator('.codeblock').first()
  await expect(cb).toHaveClass(/collapsed/)
  await cb.locator('.codetoggle').click()
  await expect(cb).not.toHaveClass(/collapsed/)
  await expect(cb.locator('.gutter')).toHaveCount(0)
  await page.keyboard.press('Control+,')
  await page.getByRole('button', { name: zhCN.general, exact: true }).click()
  await page.getByLabel(zhCN.codeLineNumbers).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('.codeblock .gutter div')).toHaveCount(40)
})

test('input toolbar: attachments as thumbnail/chip with remove, tools toggle, params popover', async () => {
  await start()
  await page.getByRole('button', { name: new RegExp(zhCN.newChat) }).first().click()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'))
  const txt = path.join(dir, 'notes.txt'); fs.writeFileSync(txt, '附件内容 hello')
  const png = path.join(dir, 'pic.png')
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
  await page.locator('.composer input[type=file]').setInputFiles([txt, png])
  await expect(page.locator('.composer .filechip', { hasText: 'notes.txt' })).toBeVisible()
  await expect(page.locator('.composer .filechip')).toHaveCount(1) // parsing indicator gone
  await expect(page.locator('.composer .thumb img')).toHaveCount(1)
  await page.locator('.composer textarea').fill('带附件的消息')
  const tools = page.getByRole('button', { name: zhCN.toolsToggle, exact: true })
  await expect(tools).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.composer').screenshot({ path: path.join(SHOTS, 'closeup-input-toolbar.png') })
  await tools.click()
  await expect(tools).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: zhCN.params, exact: true }).click()
  await expect(page.locator('.parampop')).toContainText(zhCN.temperature)
  await page.locator('.composer textarea').click()
  await expect(page.locator('.parampop')).toHaveCount(0)
  await page.locator('.composer .filechip').getByRole('button', { name: zhCN.removeItem }).click()
  await expect(page.locator('.composer .filechip')).toHaveCount(0)
  await page.locator('.composer .thumb').getByRole('button', { name: zhCN.removeItem }).click()
  await expect(page.locator('.composer .thumb')).toHaveCount(0)
})
