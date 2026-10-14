import { app, BrowserWindow, screen, ipcMain, dialog, session, shell, Menu, safeStorage, clipboard, Tray, globalShortcut, nativeImage, nativeTheme, protocol, systemPreferences, utilityProcess } from 'electron'
import crypto from 'node:crypto'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import fs from 'node:fs'
import { ToolManager, commandLine } from './tools'
import { PluginHostClient } from './plugin-client'
import { TrustStore, grantKey, fileSha256, mcpCommandHash } from './trust'
import { JsonStore, atomicWrite } from './store'
import { runBridgeRequest, type BridgeRequest } from './http'
import { encryptSettings, decryptSettings, type Cipher } from './secrets'
import { mainStrings, type MainLang } from './i18n'

if (process.env.TIDEQUILL_USER_DATA) app.setPath('userData', process.env.TIDEQUILL_USER_DATA)

/** tqpreview: HTML/SVG code-block previews. Each preview is its own document served with a strict CSP and the
 *  `sandbox allow-scripts` directive; the renderer embeds it in <iframe sandbox="allow-scripts"> (no allow-same-origin),
 *  so preview scripts get an opaque origin: no access to the app DOM, window.api (preload is main-frame only) or IPC.
 *  tqocr: serves downloaded OCR language data (userData/ocr) to the tesseract.js worker. */
protocol.registerSchemesAsPrivileged([
  { scheme: 'tqpreview', privileges: { standard: true, secure: true } },
  { scheme: 'tqocr', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])
export const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'; sandbox allow-scripts"
const previews = new Map<string, string>()
const ocrDir = () => path.join(app.getPath('userData'), 'ocr')
const OCR_LANG = /^[a-z_]{3,12}$/
/** microphone: every getUserMedia request is denied unless the voice-input button armed it just before (10 s window) */
let micArmedUntil = 0

const ALLOWED_KEYS = new Set(['settings', 'conversations', 'personas', 'prompts', 'gallery', 'modelCache', 'folders', 'tombstones'])
const dataDir = () => path.join(app.getPath('userData'), 'data')
const fileFor = (k: string) => path.join(dataDir(), k + '.json')
const allowFile = () => path.join(app.getPath('userData'), 'tool-allowlist.json') // pre-1.0.1 unscoped grants (dropped)
let tools: ToolManager
let trust: TrustStore
let store: JsonStore
/** developer mode (Round 2 · D, item 20): packaged builds only open DevTools when Settings > General > Developer mode is on */
let devMode = false
const devToolsAllowed = () => devMode || !app.isPackaged
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
function writeJSON(f: string, v: any) { atomicWrite(f, JSON.stringify(v)) }

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

/** Round 3 · A2: a window whose minimum size is larger than the work area cannot be maximized into it
 *  (at 150 % on a small screen 800×500 DIP is more than the work area), so Windows lets it overflow the screen.
 *  Clamp the minimum size and the initial size to the work area of the display the window is on. */
const MIN_W = 800, MIN_H = 500
function fitToWorkArea(w: BrowserWindow) {
  const wa = screen.getDisplayMatching(w.getBounds()).workArea
  w.setMinimumSize(Math.min(MIN_W, wa.width), Math.min(MIN_H, wa.height))
  if (w.isMaximized() || w.isFullScreen()) return
  const b = w.getBounds()
  const width = Math.min(b.width, wa.width), height = Math.min(b.height, wa.height)
  const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width), y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height)
  if (width !== b.width || height !== b.height || x !== b.x || y !== b.y) w.setBounds({ x, y, width, height })
}
/** Defensive fallback for the reported overflow: if a maximized window's client area extends past the work area
 *  (seen on some Windows setups with frameless windows; not reproducible on the CI runner, where Electron insets
 *  correctly), replace the native maximize with a window sized exactly to the work area. Clicking maximize again
 *  (or double-clicking the title bar) restores the previous bounds. TIDEQUILL_TEST_MAX_OVERFLOW forces the
 *  detection in E2E tests. */
const pseudoMax = new WeakMap<BrowserWindow, Electron.Rectangle>()
export function maximizeOverflow(w: BrowserWindow): number {
  const wa = screen.getDisplayMatching(w.getBounds()).workArea, c = w.getContentBounds()
  const forced = Number(process.env.TIDEQUILL_TEST_MAX_OVERFLOW || 0)
  return Math.max(forced, wa.x - c.x, wa.y - c.y, c.x + c.width - (wa.x + wa.width), c.y + c.height - (wa.y + wa.height))
}
function onMaximized(w: BrowserWindow) {
  const prev = pseudoMax.get(w)
  if (prev) { pseudoMax.delete(w); w.unmaximize(); w.setBounds(prev); return } // second click: restore
  if (maximizeOverflow(w) <= 1) return
  const wa = screen.getDisplayMatching(w.getBounds()).workArea
  const normal = w.getNormalBounds()
  w.unmaximize(); w.setBounds(wa); pseudoMax.set(w, normal)
}
export function isPseudoMaximized(w: BrowserWindow) { return pseudoMax.has(w) }
// read by the E2E window-geometry test through app.evaluate (main-process global; no IPC exposure)
;(globalThis as any).__tidequillGeometry = (w: BrowserWindow) => windowGeometry(w)

export function windowGeometry(w: BrowserWindow) {
  const d = screen.getDisplayMatching(w.getBounds())
  return { maximized: w.isMaximized(), pseudoMaximized: pseudoMax.has(w), bounds: w.getBounds(), content: w.getContentBounds(), workArea: d.workArea, scale: d.scaleFactor }
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea
  win = new BrowserWindow({
    width: Math.min(1280, wa.width), height: Math.min(820, wa.height), minWidth: Math.min(MIN_W, wa.width), minHeight: Math.min(MIN_H, wa.height),
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
  { const w = win; fitToWorkArea(w); w.on('moved', () => { if (!pseudoMax.has(w)) fitToWorkArea(w) }); w.on('maximize', () => setTimeout(() => { if (!w.isDestroyed() && w.isMaximized()) onMaximized(w) }, 60)); const onMetrics = () => { if (!w.isDestroyed()) fitToWorkArea(w) }
    screen.on('display-metrics-changed', onMetrics); screen.on('display-added', onMetrics); screen.on('display-removed', onMetrics)
    w.on('closed', () => { screen.off('display-metrics-changed', onMetrics); screen.off('display-added', onMetrics); screen.off('display-removed', onMetrics) })
    if (process.env.TIDEQUILL_GEOMETRY_LOG) for (const ev of ['maximize', 'unmaximize', 'resize'] as const) w.on(ev as any, () => { try { fs.appendFileSync(process.env.TIDEQUILL_GEOMETRY_LOG!, JSON.stringify({ ev, ...windowGeometry(w) }) + '\n') } catch {} }) }
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' } })
  // sub frames (HTML previews) may not navigate anywhere else
  win.webContents.on('will-frame-navigate', e => { if (!e.isMainFrame && !e.url.startsWith('tqpreview:')) e.preventDefault() })
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') && !url.startsWith(process.env.VITE_DEV_SERVER_URL || '\0')) e.preventDefault() })
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(__dirname, '../dist/index.html'))
  win.on('close', e => { if (tray && !quitting) { e.preventDefault(); win?.hide() } }) // keep running in tray
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && devToolsAllowed()) win?.webContents.toggleDevTools()
  })
  // any other way of opening DevTools (e.g. a stray shortcut) is closed again unless developer mode is on
  win.webContents.on('devtools-opened', () => { if (!devToolsAllowed()) win?.webContents.closeDevTools() })
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
  store = new JsonStore(dataDir(), path.join(app.getPath('userData'), 'backups'))
  // corruption check + backup rotation at startup (a corrupt file is restored from the newest valid backup)
  for (const k of ALLOWED_KEYS) { store.read(k); store.backup(k) }
  devMode = !!store.read('settings')?.devMode
  trust = new TrustStore(path.join(app.getPath('userData'), 'trust.json'), allowFile())
  const hostScript = path.join(__dirname, 'plugin-host.js')
  const host = new PluginHostClient(() => {
    const p = utilityProcess.fork(hostScript, [], { serviceName: 'Tidequill plugin host', stdio: 'inherit' })
    return { post: m => p.postMessage(m), onMessage: cb => p.on('message', cb), onExit: cb => p.on('exit', cb), kill: () => { p.kill() }, get pid() { return p.pid } }
  })
  tools = new ToolManager(path.join(app.getPath('userData'), 'plugins'), host, trust)
  const pluginsReady = tools.loadPlugins()
  // deny all permission requests (camera, geolocation, ...) — not needed by the app
  // the only exception: audio-only capture from the app's main frame right after the voice-input button armed it
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details: any) => {
    const types: string[] = details?.mediaTypes || []
    const origin = String(details?.requestingUrl || '')
    const ok = perm === 'media' && !!win && wc === win.webContents && details?.isMainFrame !== false && Date.now() < micArmedUntil
      && types.length > 0 && types.every(t => t === 'audio') && (origin.startsWith('file:') || (!!process.env.VITE_DEV_SERVER_URL && origin.startsWith(process.env.VITE_DEV_SERVER_URL)))
    if (ok) micArmedUntil = 0
    cb(ok)
  })
  ipcMain.handle('mic:arm', async e => {
    if (!win || e.sender !== win.webContents) return false
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
      if (!(await systemPreferences.askForMediaAccess('microphone'))) return false
    }
    micArmedUntil = Date.now() + 10_000
    return true
  })

  protocol.handle('tqpreview', req => {
    const id = new URL(req.url).pathname.replace(/^\//, '')
    const html = previews.get(id)
    if (html === undefined) return new Response('not found', { status: 404 })
    // the same policy is also put inside the document (meta), in addition to the response header
    const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP.replace(/; sandbox.*$/, '')}">`
    const doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + meta) : meta + html
    return new Response(doc, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PREVIEW_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } })
  })
  ipcMain.handle('preview:put', (e, html: string) => {
    if (!win || e.sender !== win.webContents) throw new Error('denied')
    const id = crypto.randomUUID()
    previews.set(id, String(html).slice(0, 2_000_000))
    while (previews.size > 50) previews.delete(previews.keys().next().value!)
    return `tqpreview://p/${id}`
  })
  protocol.handle('tqocr', req => {
    const f = path.basename(new URL(req.url).pathname)
    if (!/^[a-z_]{3,12}\.traineddata(\.gz)?$/.test(f)) return new Response('bad name', { status: 400 })
    const fp = path.join(ocrDir(), f.endsWith('.gz') ? f : f + '.gz')
    if (!fs.existsSync(fp)) return new Response('not downloaded', { status: 404 })
    return new Response(fs.readFileSync(fp), { headers: { 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': '*' } })
  })
  ipcMain.handle('ocr:status', (_e, langs: string[]) => Object.fromEntries((langs || []).filter(l => OCR_LANG.test(l)).map(l => {
    try { return [l, fs.statSync(path.join(ocrDir(), l + '.traineddata.gz')).size] } catch { return [l, 0] }
  })))
  // language data is downloaded through the API session (same proxy settings as model requests)
  ipcMain.handle('ocr:download', async (_e, lang: string, source: string) => {
    if (!OCR_LANG.test(lang)) return { ok: false, error: 'invalid language code' }
    const url = String(source || '').replaceAll('{lang}', lang)
    if (!/^https?:\/\//.test(url)) return { ok: false, error: 'only http(s) sources are allowed' }
    try {
      const res = await apiSession().fetch(url)
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 50_000) return { ok: false, error: `file too small (${buf.length} bytes)` }
      fs.mkdirSync(ocrDir(), { recursive: true })
      fs.writeFileSync(path.join(ocrDir(), lang + '.traineddata.gz'), buf)
      return { ok: true, size: buf.length }
    } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
  })

  ipcMain.handle('kv:get', (_e, k: string) => {
    if (!ALLOWED_KEYS.has(k)) throw new Error('invalid key')
    const v = store.read(k)
    if (k !== 'settings' || !v) return v
    const { settings, needsMigration } = decryptSettings(v, cipher)
    if (needsMigration) writeJSON(fileFor(k), encryptSettings(v, cipher)) // migrate plaintext keys
    return settings
  })
  ipcMain.handle('kv:set', (_e, k: string, v: any) => {
    if (!ALLOWED_KEYS.has(k)) throw new Error('invalid key')
    store.write(k, k === 'settings' ? encryptSettings(v, cipher) : v)
  })
  ipcMain.handle('storage:notices', () => store.notices)
  ipcMain.handle('storage:dismiss', () => { store.notices = [] })
  ipcMain.handle('devmode:set', (_e, on: boolean) => { devMode = !!on; if (!devToolsAllowed()) win?.webContents.closeDevTools(); return { devMode, packaged: app.isPackaged } })
  ipcMain.handle('devtools:isOpen', () => !!win?.webContents.isDevToolsOpened())
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
  ipcMain.handle('tools:sync', async (_e, servers) => { await tools.loadPlugins(); await tools.syncMcp(servers); return tools.status() })
  ipcMain.handle('tools:status', async () => { await pluginsReady; return tools.status() })
  ipcMain.handle('tools:list', () => tools.listTools())
  ipcMain.handle('tools:grants', () => trust.read())
  ipcMain.handle('tools:revoke', (_e, key: string) => trust.update(t => { t.grants = t.grants.filter(x => x !== key) }))
  ipcMain.handle('tools:revokeAll', async () => { const t = trust.update(t => { t.grants = []; t.plugins = {}; t.mcp = {} }); await tools.loadPlugins(); return t })
  // plugin first load: the renderer shows path + SHA-256; main re-hashes the file so only the confirmed content is trusted
  ipcMain.handle('plugins:trust', async (_e, file: string, sha: string) => {
    const p = tools.pending.find(x => x.path === file)
    if (!p) return { ok: false, error: 'unknown plugin' }
    if (fileSha256(p.path) !== sha) return { ok: false, error: 'file changed, review again' }
    trust.update(t => { t.plugins[p.path] = sha })
    await tools.loadPlugins(); return { ok: true, status: tools.status() }
  })
  ipcMain.handle('plugins:untrust', async (_e, file: string) => {
    trust.update(t => { delete t.plugins[file]; const name = tools.plugins.find(x => x.file === file)?.name; if (name) t.grants = t.grants.filter(g => !g.startsWith(`plugin:${name}::`)) })
    await tools.loadPlugins(); return tools.status()
  })
  // MCP stdio: the renderer shows the exact command line; approval is bound to a hash of command + args + env
  ipcMain.handle('mcp:preview', (_e, cfg) => ({ commandLine: commandLine(cfg), envKeys: Object.keys(cfg?.env || {}), approved: trust.read().mcp[cfg?.id] === mcpCommandHash(cfg || {}) }))
  ipcMain.handle('mcp:approve', (_e, cfg) => { trust.update(t => { t.mcp[String(cfg.id)] = mcpCommandHash(cfg) }); return true })
  ipcMain.handle('mcp:revoke', (_e, id: string) => trust.update(t => { delete t.mcp[id]; t.grants = t.grants.filter(g => !g.startsWith(`mcp:${id}::`)) }))
  ipcMain.handle('tools:call', async (_e, name: string, args: any) => {
    const src = tools.resolve(name)
    if (!src) return `Tool not found: ${name}`
    const key = grantKey(src.source, src.tool)
    if (!trust.read().grants.includes(key)) {
      const s = mainStrings[lang]
      const r = await dialog.showMessageBox(win!, {
        type: 'question', title: s.toolTitle, message: s.toolMessage.replace('{name}', name),
        detail: s.toolSource.replace('{source}', src.label) + '\n' + s.toolDetail.replace('{args}', JSON.stringify(args, null, 2)),
        buttons: [s.allow, s.deny], defaultId: 1, cancelId: 1, checkboxLabel: s.always.replace('{source}', src.label), checkboxChecked: false, noLink: true,
      })
      if (r.response !== 0) return s.denied
      if (r.checkboxChecked) trust.update(t => { t.grants = [...new Set([...t.grants, key])] })
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
    const pdf = await win!.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
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
