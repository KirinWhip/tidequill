import { app, BrowserWindow, ipcMain, dialog, session, shell, Menu, net, safeStorage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { ToolManager } from './tools'
import { runBridgeRequest, type BridgeRequest } from './http'
import { encryptSettings, decryptSettings, type Cipher } from './secrets'
import { mainStrings, type MainLang } from './i18n'

if (process.env.CHATBOX_USER_DATA) app.setPath('userData', process.env.CHATBOX_USER_DATA)

const ALLOWED_KEYS = new Set(['settings', 'conversations', 'personas', 'prompts', 'gallery'])
const dataDir = () => path.join(app.getPath('userData'), 'data')
const fileFor = (k: string) => path.join(dataDir(), k + '.json')
const allowFile = () => path.join(app.getPath('userData'), 'tool-allowlist.json')
let tools: ToolManager
let win: BrowserWindow | null = null
let lang: MainLang = 'zh'
const inflight = new Map<string, AbortController>()

const cipher: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: s => safeStorage.encryptString(s).toString('base64'),
  decrypt: s => safeStorage.decryptString(Buffer.from(s, 'base64')),
}

function readJSON(f: string) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return undefined } }
function writeJSON(f: string, v: any) { fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f) }
const readAllow = (): string[] => readJSON(allowFile()) || []

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 800, minHeight: 500,
    title: 'ChatBox Clone',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  Menu.setApplicationMenu(null)
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') && !url.startsWith(process.env.VITE_DEV_SERVER_URL || '\0')) e.preventDefault() })
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(__dirname, '../dist/index.html'))
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools()
  })
}

app.whenReady().then(() => {
  fs.mkdirSync(dataDir(), { recursive: true })
  tools = new ToolManager(path.join(app.getPath('userData'), 'plugins'))
  tools.loadPlugins()
  // deny all permission requests (camera, geolocation, ...) — not needed by the app
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false))

  ipcMain.handle('kv:get', (_e, k: string) => {
    if (!ALLOWED_KEYS.has(k)) throw new Error('invalid key')
    const v = readJSON(fileFor(k))
    if (k !== 'settings' || !v) return v
    const { settings, needsMigration } = decryptSettings(v, cipher)
    if (needsMigration) writeJSON(fileFor(k), encryptSettings(v, cipher)) // migrate plaintext keys
    return settings
  })
  ipcMain.handle('kv:set', (_e, k: string, v: any) => {
    if (!ALLOWED_KEYS.has(k)) throw new Error('invalid key')
    writeJSON(fileFor(k), k === 'settings' ? encryptSettings(v, cipher) : v)
  })
  ipcMain.handle('secure:status', () => ({ available: safeStorage.isEncryptionAvailable(), backend: process.platform === 'linux' ? (safeStorage as any).getSelectedStorageBackend?.() : 'os' }))
  ipcMain.handle('proxy:set', async (_e, proxy: string) => {
    await session.defaultSession.setProxy(proxy ? { proxyRules: proxy, proxyBypassRules: 'localhost,127.0.0.1,<local>' } : { mode: 'system' })
  })
  ipcMain.handle('app:locale', () => app.getLocale())
  ipcMain.handle('app:setLanguage', (_e, l: string) => { lang = l === 'en' ? 'en' : 'zh' })
  ipcMain.handle('app:version', () => app.getVersion())

  // ---- HTTP bridge (provider requests go through main, renderer keeps webSecurity on) ----
  ipcMain.on('http:start', (e, id: string, req: BridgeRequest) => {
    const ctrl = new AbortController(); inflight.set(id, ctrl)
    const wc = e.sender
    runBridgeRequest(net.fetch as any, req, ev => { if (!wc.isDestroyed()) wc.send('http:event', id, ev) }, ctrl.signal).finally(() => inflight.delete(id))
  })
  ipcMain.on('http:abort', (_e, id: string) => inflight.get(id)?.abort())

  ipcMain.handle('file:save', async (_e, name: string, content: string) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: name })
    if (r.canceled || !r.filePath) return false
    fs.writeFileSync(r.filePath, content); return true
  })
  ipcMain.handle('file:open', async (_e, exts: string[]) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Files', extensions: exts }] })
    if (r.canceled || !r.filePaths[0]) return null
    return { name: path.basename(r.filePaths[0]), content: fs.readFileSync(r.filePaths[0], 'utf8') }
  })

  // ---- tools: every call needs user confirmation unless "always allow" was chosen ----
  ipcMain.handle('tools:sync', async (_e, servers) => { tools.loadPlugins(); await tools.syncMcp(servers); return tools.status() })
  ipcMain.handle('tools:status', () => tools.status())
  ipcMain.handle('tools:list', () => tools.listTools())
  ipcMain.handle('tools:allowlist', () => readAllow())
  ipcMain.handle('tools:revoke', (_e, name: string) => { writeJSON(allowFile(), readAllow().filter(x => x !== name)); return readAllow() })
  ipcMain.handle('tools:call', async (_e, name: string, args: any) => {
    if (!readAllow().includes(name)) {
      const s = mainStrings[lang]
      const r = await dialog.showMessageBox(win!, {
        type: 'question', title: s.toolTitle, message: s.toolMessage.replace('{name}', name),
        detail: s.toolDetail.replace('{args}', JSON.stringify(args, null, 2)),
        buttons: [s.allow, s.deny], defaultId: 1, cancelId: 1, checkboxLabel: s.always, checkboxChecked: false, noLink: true,
      })
      if (r.response !== 0) return s.denied
      if (r.checkboxChecked) writeJSON(allowFile(), [...new Set([...readAllow(), name])])
    }
    return tools.callTool(name, args)
  })
  ipcMain.handle('plugins:openDir', () => shell.openPath(path.join(app.getPath('userData'), 'plugins')))

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
