import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** path of the packaged app executable (override with APP_PATH) */
export function appPath(): string {
  if (process.env.APP_PATH) return process.env.APP_PATH
  const rel = path.resolve(__dirname, '..', 'release')
  if (process.platform === 'win32') return path.join(rel, 'win-unpacked', 'ChatBox Clone.exe')
  if (process.platform === 'darwin') return path.join(rel, 'mac', 'ChatBox Clone.app', 'Contents', 'MacOS', 'ChatBox Clone')
  return path.join(rel, 'linux-unpacked', 'chatbox-clone')
}

export interface Seed { mockUrl: string; language?: 'zh' | 'en' | 'system'; theme?: 'light' | 'dark'; conversations?: any[]; model?: string }

export function seedUserData(seed: Seed): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbox-e2e-'))
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
  const settings = {
    language: seed.language || 'zh', theme: seed.theme || 'light', fontSize: 14, temperature: 0.7, maxTokens: 512, contextLength: 20,
    proxy: '', requestTimeout: 3, sendKey: 'Enter', toolsEnabled: true, mcpServers: [],
    providers: [
      { id: 'mock', name: 'Mock', type: 'openai', apiKey: 'sk-plaintext-e2e', baseURL: seed.mockUrl, models: ['mock-ok', 'mock-401', 'mock-429', 'mock-timeout', 'mock-disconnect', 'mock-tool'] },
      { id: 'down', name: 'Down', type: 'openai', apiKey: 'x', baseURL: 'http://127.0.0.1:9/v1', models: ['mock-ok'] },
    ],
    defaultProviderId: 'mock', defaultModel: seed.model || 'mock-ok', imageProviderId: 'mock', imageModel: 'dall-e-3',
  }
  fs.writeFileSync(path.join(dir, 'data', 'settings.json'), JSON.stringify(settings))
  if (seed.conversations) fs.writeFileSync(path.join(dir, 'data', 'conversations.json'), JSON.stringify(seed.conversations))
  return dir
}

export async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page; consoleErrors: string[] }> {
  const app = await electron.launch({
    executablePath: appPath(),
    args: process.platform === 'linux' ? ['--no-sandbox', ...(process.env.E2E_EXTRA_ARGS || '').split(' ').filter(Boolean)] : [],
    env: { ...process.env, CHATBOX_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '1' },
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
