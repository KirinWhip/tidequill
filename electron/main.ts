import { app, BrowserWindow, ipcMain, dialog, session, shell, Menu, net, safeStorage, clipboard, Tray, globalShortcut, nativeImage } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import fs from 'node:fs'
import { ToolManager } from './tools'
import { runBridgeRequest, type BridgeRequest } from './http'
import { encryptSettings, decryptSettings, type Cipher } from './secrets'
import { mainStrings, type MainLang } from './i18n'

if (process.env.TIDEQUILL_USER_DATA) app.setPath('userData', process.env.TIDEQUILL_USER_DATA)

const ALLOWED_KEYS = new Set(['settings', 'conversations', 'personas', 'prompts', 'gallery', 'modelCache', 'folders', 'tombstones'])
const dataDir = () => path.join(app.getPath('userData'), 'data')
const fileFor = (k: string) => path.join(dataDir(), k + '.json')
const allowFile = () => path.join(app.getPath('userData'), 'tool-allowlist.json')
let tools: ToolManager
let win: BrowserWindow | null = null
let lang: MainLang = 'zh'
let tray: Tray | null = null
let quitting = false
let currentShortcut = ''
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
    title: 'Tidequill',
    icon: resourcePath('icon.png'),
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
  win.on('close', e => { if (tray && !quitting) { e.preventDefault(); win?.hide() } }) // keep running in tray
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools()
  })
}

/** 1.0 renamed the app; copy data once from the pre-1.0 profile folder so upgrades keep their conversations */
function migrateLegacyProfile() {
  if (process.env.TIDEQUILL_USER_DATA) return
  const legacy = path.join(app.getPath('appData'), LEGACY_PRODUCT_NAME)
  try {
    if (fs.existsSync(path.join(legacy, 'data')) && !fs.existsSync(dataDir())) {
      for (const sub of ['data', 'plugins']) if (fs.existsSync(path.join(legacy, sub))) fs.cpSync(path.join(legacy, sub), path.join(app.getPath('userData'), sub), { recursive: true })
      if (fs.existsSync(path.join(legacy, 'tool-allowlist.json'))) fs.copyFileSync(path.join(legacy, 'tool-allowlist.json'), allowFile())
    }
  } catch (e) { console.error('legacy profile migration failed', e) }
}
const LEGACY_PRODUCT_NAME = 'ChatBox Clone' // product name used before v1.0

export const ABOUT = { name: 'Tidequill', nameZh: '\u6f6e\u7b3a', license: 'MIT', author: '\u8ffd\u9010', repo: 'https://github.com/KirinWhip/tidequill' }

app.whenReady().then(() => {
  migrateLegacyProfile()
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
  // clipboard write goes through main (renderer permission requests are all denied)
  ipcMain.handle('clipboard:write', (_e, text: string) => { clipboard.writeText(String(text).slice(0, 5_000_000)) })

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
  // ---- system integration ----
  ipcMain.handle('app:about', () => ({ ...ABOUT, version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }))
  ipcMain.handle('app:notices', () => { for (const f of [resourcePath('THIRD_PARTY_NOTICES.txt'), path.join(__dirname, '..', 'THIRD_PARTY_NOTICES.txt')]) { try { return fs.readFileSync(f, 'utf8') } catch { /* try next */ } } return '' })
  ipcMain.handle('app:openRepo', () => shell.openExternal(ABOUT.repo))
  ipcMain.handle('system:apply', (_e, o: { globalShortcut: string; tray: boolean; launchAtLogin: boolean }) => applySystem(o))
  ipcMain.handle('update:check', async () => {
    try {
      autoUpdater.autoDownload = false
      if (process.env.TIDEQUILL_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.TIDEQUILL_UPDATE_URL })
      const r = await autoUpdater.checkForUpdates()
      if (!r) return { status: 'unsupported', current: app.getVersion() }
      const latest = r.updateInfo.version
      return { status: r.isUpdateAvailable ?? latest !== app.getVersion() ? 'available' : 'latest', latest, current: app.getVersion() }
    } catch (e: any) { return { status: 'error', error: String(e?.message || e).slice(0, 300), current: app.getVersion() } }
  })
  ipcMain.handle('update:download', async () => { await autoUpdater.downloadUpdate(); return true })
  ipcMain.handle('update:install', () => { quitting = true; autoUpdater.quitAndInstall() })
  ipcMain.handle('pdf:export', async (_e, name: string) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (r.canceled || !r.filePath) return false
    const pdf = await win!.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } })
    fs.writeFileSync(r.filePath, pdf); return true
  })
  ipcMain.handle('window:toggle', () => toggleWindow())
  ipcMain.handle('plugins:openDir', () => shell.openPath(path.join(app.getPath('userData'), 'plugins')))

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

function toggleWindow() {
  if (!win) return
  if (win.isVisible() && win.isFocused()) win.hide()
  else { win.show(); win.focus() }
}

function resourcePath(f: string) {
  return app.isPackaged ? path.join(process.resourcesPath, f) : path.join(__dirname, '..', 'build', f)
}

function applySystem(o: { globalShortcut: string; tray: boolean; launchAtLogin: boolean }) {
  const res: { shortcut: boolean; tray: boolean; loginItem: boolean; loginSupported: boolean } = { shortcut: false, tray: false, loginItem: false, loginSupported: process.platform === 'win32' || process.platform === 'darwin' }
  // global show/hide shortcut
  if (currentShortcut) globalShortcut.unregister(currentShortcut)
  currentShortcut = ''
  if (o.globalShortcut) {
    try { res.shortcut = globalShortcut.register(o.globalShortcut, toggleWindow); if (res.shortcut) currentShortcut = o.globalShortcut } catch { res.shortcut = false }
  }
  // tray
  if (o.tray && !tray) {
    const s = mainStrings[lang]
    tray = new Tray(nativeImage.createFromPath(resourcePath('tray.png')))
    tray.setToolTip('Tidequill')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: s.trayShow, click: toggleWindow },
      { label: s.trayNew, click: () => { win?.show(); win?.webContents.send('app:command', 'newChat') } },
      { type: 'separator' },
      { label: s.trayQuit, click: () => { quitting = true; app.quit() } },
    ]))
    tray.on('click', toggleWindow)
  } else if (!o.tray && tray) { tray.destroy(); tray = null }
  res.tray = !!tray
  // launch at login (Windows/macOS; not supported by Electron on Linux)
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: !!o.launchAtLogin })
    res.loginItem = app.getLoginItemSettings().openAtLogin === !!o.launchAtLogin
  }
  return res
}

app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
