// Round 3 · A5: Claude via a strict local mock of the Anthropic Messages API
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
const claude = () => ({ providers: [{ id: 'claude', name: 'Claude', type: 'anthropic', apiKey: 'sk-ant-e2e-secret', baseURL: mock.url.replace(/\/v1$/, ''), models: ['claude-sonnet-5-5', 'claude-sonnet-4-5'] }],
  defaultProviderId: 'claude', defaultModel: 'claude-sonnet-5-5', temperature: 0.7, topP: 1 })
const C = (id: string, model: string, extra: any = {}) => ({ id, title: id, pinned: false, providerId: 'claude', model, systemPrompt: '', createdAt: Date.now(), updatedAt: Date.now(), messages: [], ...extra })

test('claude-sonnet-5-5: the first message succeeds (no sampling params; thinking off = between_tools)', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, settings: claude(), conversations: [C('s55', 'claude-sonnet-5-5')] })))
  await page.locator('.conv').first().click()
  const n0 = mock.anthropic.length
  await send(page, '你好 你是谁 你能干啥?')
  await expect(page.locator('.msg.assistant').last()).toContainText('Claude 模拟回复')
  await expect(page.getByTestId('error-card')).toHaveCount(0)
  expect(mock.anthropic.length).toBe(n0 + 1) // first request, no retry
  const b = mock.anthropic.at(-1).body
  expect(b.temperature).toBeUndefined(); expect(b.top_p).toBeUndefined(); expect(b.thinking).toEqual({ type: 'between_tools' })
  expect(mock.anthropic.at(-1).headers['x-api-key']).toBe('sk-ant-e2e-secret')
  // deep thinking on: adaptive + summarized, thinking text shown
  await page.getByRole('button', { name: zhCN.reasoning, exact: true }).click()
  await send(page, '再来一次')
  await expect(page.locator('.msg.assistant').last()).toContainText('一切正常')
  expect(mock.anthropic.at(-1).body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
  await expect(page.locator('.msg.assistant').last().locator('.reasoning')).toBeVisible()
})

test('400 error card: server body + redacted request summary, 重试 / 关闭深度思考后重试 / 复制详情', async () => {
  ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url, settings: claude(), conversations: [C('e400', 'claude-sonnet-4-5', { reasoning: true })] })))
  await page.locator('.conv').first().click()
  await send(page, '机密问题 [mock-400-thinking]')
  const card = page.getByTestId('error-card')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('data-error-code', 'bad_request')
  await expect(card).toContainText(zhCN.err_bad_request)
  await card.getByTestId('error-details').locator('summary').click()
  await expect(card.getByTestId('error-body')).toContainText('invalid_request_error')
  await expect(card.getByTestId('error-body')).toContainText('req_mock_400')
  const summary = await card.getByTestId('error-request').innerText()
  expect(summary).toContain('"model": "claude-sonnet-4-5"'); expect(summary).toContain('"budget_tokens"'); expect(summary).toContain('"x-api-key": "***"')
  expect(summary).not.toContain('sk-ant-e2e-secret'); expect(summary).not.toContain('机密问题')
  await expect(card.getByTestId('err-retry')).toHaveText(zhCN.errRetry)
  await expect(card.getByTestId('err-retry-nothink')).toHaveText(zhCN.retryNoThinking)
  await expect(card.getByTestId('err-copy')).toHaveText(zhCN.copyDetails)
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(SHOTS, 'error-400-details.png') })
  // copy details -> clipboard (via main), no key in it
  await card.getByTestId('err-copy').click()
  await expect(card.getByTestId('err-copy')).toHaveText(zhCN.copied)
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(clip).toContain('invalid_request_error'); expect(clip).not.toContain('sk-ant-e2e-secret')
  // plain retry fails again (thinking still on)
  const n = mock.anthropic.length
  await card.getByTestId('err-retry').click()
  await expect.poll(() => mock.anthropic.length).toBe(n + 1)
  await expect(page.getByTestId('error-card')).toBeVisible()
  // retry without deep thinking succeeds and turns the toggle off for this conversation
  await page.getByTestId('error-card').getByTestId('err-retry-nothink').click()
  await expect(page.locator('.msg.assistant').last()).toContainText('Claude 模拟回复')
  expect(mock.anthropic.at(-1).body.thinking).toBeUndefined()
  await expect(page.getByRole('button', { name: zhCN.reasoning, exact: true })).toHaveAttribute('aria-pressed', 'false')
})
