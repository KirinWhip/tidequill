import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** path of the packaged app executable (override with APP_PATH) */
export function appPath(): string {
  if (process.env.APP_PATH) return process.env.APP_PATH
  const rel = path.resolve(__dirname, '..', 'release')
  if (process.platform === 'win32') return path.join(rel, 'win-unpacked', 'Tidequill.exe')
  if (process.platform === 'darwin') return path.join(rel, 'mac', 'Tidequill.app', 'Contents', 'MacOS', 'Tidequill')
  return path.join(rel, 'linux-unpacked', 'tidequill')
}

export interface Seed { mockUrl: string; language?: 'zh' | 'en' | 'system'; theme?: 'light' | 'dark'; conversations?: any[]; model?: string; settings?: Record<string, any>; files?: Record<string, any> }

export function seedUserData(seed: Seed): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidequill-e2e-'))
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
  const settings = {
    language: seed.language || 'zh', theme: seed.theme || 'light', fontSize: 14, temperature: 0.7, maxTokens: 512, contextLength: 20,
    proxy: '', requestTimeout: 3, sendKey: 'Enter', toolsEnabled: true, chatDefaults: { reasoning: false, tools: true, webSearch: false }, builtinTools: true, autoTitle: false, mcpServers: [],
    providers: [
      { id: 'mock', name: 'Mock', type: 'openai', apiKey: 'sk-plaintext-e2e', baseURL: seed.mockUrl, models: ['mock-ok', 'mock-401', 'mock-429', 'mock-timeout', 'mock-disconnect', 'mock-tool'] },
      { id: 'down', name: 'Down', type: 'openai', apiKey: 'x', baseURL: 'http://127.0.0.1:9/v1', models: ['mock-ok'] },
    ],
    defaultProviderId: 'mock', defaultModel: seed.model || 'mock-ok', imageProviderId: 'mock', imageModel: 'dall-e-3',
    retries: 0, retryBaseMs: 300, autoCheckUpdate: false, tray: false, globalShortcut: '',
    ...(seed.settings || {}),
  }
  fs.writeFileSync(path.join(dir, 'data', 'settings.json'), JSON.stringify(settings))
  for (const [k, v] of Object.entries(seed.files || {})) fs.writeFileSync(path.join(dir, 'data', k + '.json'), JSON.stringify(v))
  if (seed.conversations) fs.writeFileSync(path.join(dir, 'data', 'conversations.json'), JSON.stringify(seed.conversations))
  return dir
}

/** per-launch main-process HTTP timing log (diagnostics, uploaded with the CI report) */
export const HTTP_LOG_DIR = path.resolve(__dirname, '..', 'test-results', 'http-logs')
export function httpLogFile(userData: string) { fs.mkdirSync(HTTP_LOG_DIR, { recursive: true }); return path.join(HTTP_LOG_DIR, path.basename(userData) + '.jsonl') }

// diagnostics: event-loop stalls of the Playwright worker (which also hosts the mock / WebDAV servers)
{ let last = Date.now(); const f = () => path.join(HTTP_LOG_DIR, `worker-lag-${process.pid}.jsonl`)
  setInterval(() => { const now = Date.now(); if (now - last > 350) { try { fs.mkdirSync(HTTP_LOG_DIR, { recursive: true }); fs.appendFileSync(f(), JSON.stringify({ at: now, ms: now - last - 100 }) + '\n') } catch {} } last = now }, 100).unref() }

export async function launch(userData: string, extraEnv: Record<string, string> = {}, extraArgs: string[] = []): Promise<{ app: ElectronApplication; page: Page; consoleErrors: string[] }> {
  const app = await electron.launch({
    executablePath: appPath(),
    args: [...(process.platform === 'linux' ? ['--no-sandbox', ...(process.env.E2E_EXTRA_ARGS || '').split(' ').filter(Boolean)] : []),
      ...(process.env.E2E_NETLOG ? [`--log-net-log=${httpLogFile(userData).replace(/\.jsonl$/, '.netlog.json')}`] : []), ...extraArgs],
    env: { ...process.env, TIDEQUILL_USER_DATA: userData, TIDEQUILL_HTTP_LOG: httpLogFile(userData), ELECTRON_ENABLE_LOGGING: '1', ...extraEnv },
  })
  const page = await app.firstWindow()
  const consoleErrors: string[] = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  await page.waitForSelector('.app', { timeout: 30_000 })
  return { app, page, consoleErrors }
}

export async function send(page: Page, text: string) {
  const ta = page.locator('.composer textarea')
  await ta.fill(text)
  await ta.press('Enter')
}

export function dumpMockTimings(name: string, mock: { timings?: any[]; port?: number }) {
  try { fs.mkdirSync(HTTP_LOG_DIR, { recursive: true }); fs.writeFileSync(path.join(HTTP_LOG_DIR, `mock-${name}-${mock.port}-${Date.now()}.jsonl`), (mock.timings || []).map(x => JSON.stringify(x)).join('\n')) } catch { /* ignore */ }
}
