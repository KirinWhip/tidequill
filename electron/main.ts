import { app, BrowserWindow, ipcMain, dialog, session, shell, Menu, net, safeStorage, clipboard, Tray, globalShortcut, nativeImage, nativeTheme } from 'electron'
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
/** Provider / WebDAV requests use an in-memory session (no 'persist:' prefix, no HTTP cache).
 *  Reason (root cause of the flaky Windows E2E timeouts in Round 2 · A): with the default persistent session the FIRST
 *  request of every app start waits until Chromium has loaded the on-disk SQLite cookie store of the profile
 *  (netlog: COOKIE_PERSISTENT_STORE_LOAD, median ~130 ms, but 1.4 s and 4.8 s observed on the Windows runner),
 *  which the 3 s idle timeout of the tests counted as "no response". API calls never need cookies. */
let apiSess: Electron.Session | null = null
const apiSession = () => (apiSess ||= session.fromPartition('tidequill-api', { cache: false }))
/** diagnostics (tests only): TIDEQUILL_HTTP_LOG=<file> records bridge timings and main-process event-loop stalls */
const HTTP_LOG = process.env.TIDEQUILL_HTTP_LOG || ''
const httpLog = (o: any) => { try { fs.appendFileSync(HTTP_LOG, JSON.stringify({ at: Date.now(), ...o }) + '\n') } catch { /* ignore */ } }
if (HTTP_LOG) { let last = Date.now(); setInterval(() => { const now = Date.now(); if (now - last > 400) httpLog({ ev: 'stall', ms: now - last - 100, uptimeMs: Math.round(process.uptime() * 1000) }); last = now }, 100).unref() }
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

/** custom title bar: the renderer draws it, the OS keeps only the window buttons (Window Controls Overlay)
 *  whose colors follow the app theme, not the system accent color */
export const TITLEBAR_HEIGHT = 36
const TB_COLORS = { light: { color: '#f6f7f9', symbolColor: '#111827' }, dark: { color: '#1f2126', symbolColor: '#e8eaed' } }
function initialDark() {
  const theme = readJSON(fileFor('settings'))?.theme
  return theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors)
}
function titleBarOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') return { titleBarStyle: 'hiddenInset' }
  return { titleBarStyle: 'hidden', titleBarOverlay: { ...TB_COLORS[initialDark() ? 'dark' : 'light'], height: TITLEBAR_HEIGHT } }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 800, minHeight: 500,
    title: 'Tidequill',
    ...titleBarOptions(),
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
    const cfg: Electron.ProxyConfig = proxy ? { proxyRules: proxy, proxyBypassRules: 'localhost,127.0.0.1,<local>' } : { mode: 'system' }
    await Promise.all([session.defaultSession.setProxy(cfg), apiSession().setProxy(cfg)])
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
    const t0 = Date.now(); let tHead = 0, tFirst = 0
    if (HTTP_LOG) apiSession().resolveProxy(req.url).then(p => httpLog({ id, ev: 'proxy', proxy: p, ms: Date.now() - t0 }))
    runBridgeRequest(apiSession().fetch.bind(apiSession()) as any, req, ev => {
      if (HTTP_LOG) {
        if (ev.type === 'head' && !tHead) tHead = Date.now()
        if (ev.type === 'chunk' && !tFirst) tFirst = Date.now()
        if (ev.type === 'end' || ev.type === 'error') httpLog({ id, url: req.url.replace(/\?.*/, ''), t0, headMs: tHead ? tHead - t0 : null, firstChunkMs: tFirst ? tFirst - t0 : null, endMs: Date.now() - t0, result: ev.type === 'error' ? ev.code : 'ok', uptimeMs: Math.round(process.uptime() * 1000) })
      }
      if (!wc.isDestroyed()) wc.send('http:event', id, ev)
    }, ctrl.signal).finally(() => inflight.delete(id))
  })
  ipcMain.handle('titlebar:theme', (_e, dark: boolean) => {
    if (process.platform === 'darwin' || !win) return false
    try { win.setTitleBarOverlay({ ...TB_COLORS[dark ? 'dark' : 'light'], height: TITLEBAR_HEIGHT }); return true } catch { return false }
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
