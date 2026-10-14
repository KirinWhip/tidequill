// Round 3 · A2: maximized frameless window must fit the screen work area at 100 / 125 / 150 % scale,
// with the caption buttons (Window Controls Overlay) and the sidebar bottom (设置 / 关于) fully visible.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, seedUserData } from './helpers'
// @ts-ignore
import { startMockServer } from '../tests/mock-server.mjs'

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'r3')
fs.mkdirSync(SHOTS, { recursive: true })
let mock: any
test.beforeAll(async () => { mock = await startMockServer() })
test.afterAll(async () => { await mock.close() })
let app: ElectronApplication, page: Page
test.afterEach(async () => { await app?.close().catch(() => {}) })

/** window geometry as seen by the main process (DIP) and by the page (CSS px) */
async function geometry() {
  const main = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const d = screen.getDisplayMatching(w.getBounds())
    return { maximized: w.isMaximized(), bounds: w.getBounds(), content: w.getContentBounds(), workArea: d.workArea, displayBounds: d.bounds, scale: d.scaleFactor }
  })
  const page_ = await page.evaluate(() => {
    const wco = (navigator as any).windowControlsOverlay
    const r = (sel: string) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom, right: b.right } }
    return { inner: { w: innerWidth, h: innerHeight }, dpr: devicePixelRatio, wcoVisible: !!wco?.visible, titlebarArea: wco?.visible ? (({ x, y, width, height }: DOMRect) => ({ x, y, width, height }))(wco.getTitlebarAreaRect()) : null,
      nav: r('.sidenav'), sidebar: r('.sidebar'), composer: r('.composer') }
  })
  return { ...main, page: page_ }
}

async function screenShot(name: string) {
  // the whole screen (not just the page) so an overflowing window or cut-off caption buttons are visible
  const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]; const d = screen.getDisplayMatching(w.getBounds())
    const src = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) } })
    const s = src.find(x => x.display_id === String(d.id)) || src[0]
    return s && !s.thumbnail.isEmpty() ? s.thumbnail.toPNG().toString('base64') : ''
  }).catch(() => '')
  if (png) fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(png, 'base64'))
  else await page.screenshot({ path: path.join(SHOTS, name + '.png') })
}

for (const scale of [1, 1.25, 1.5]) {
  test(`maximized window fits the work area at scale ${scale}`, async () => {
    test.skip(process.platform !== 'win32', 'maximize geometry needs a real window manager (Windows runner)')
    ;({ app, page } = await launch(seedUserData({ mockUrl: mock.url }), {}, [`--force-device-scale-factor=${scale}`]))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
    await expect.poll(async () => (await geometry()).maximized).toBe(true)
    await page.waitForTimeout(500)
    const g = await geometry()
    test.info().annotations.push({ type: 'geometry', description: JSON.stringify(g) })
    fs.writeFileSync(path.join(SHOTS, `maximized-${Math.round(scale * 100)}.json`), JSON.stringify(g, null, 2))
    await screenShot(`maximized-${Math.round(scale * 100)}`)
    const wa = g.workArea, c = g.content
    // client area (what the user sees) lies inside the work area (1 DIP rounding tolerance)
    expect(c.x).toBeGreaterThanOrEqual(wa.x - 1)
    expect(c.y).toBeGreaterThanOrEqual(wa.y - 1)
    expect(c.x + c.width).toBeLessThanOrEqual(wa.x + wa.width + 1)
    expect(c.y + c.height).toBeLessThanOrEqual(wa.y + wa.height + 1)
    // and fills it (a maximized window should not leave gaps either)
    expect(c.width).toBeGreaterThanOrEqual(wa.width - 2)
    expect(c.height).toBeGreaterThanOrEqual(wa.height - 2)
    // page viewport equals the client area
    expect(Math.abs(g.page.inner.w - c.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(g.page.inner.h - c.height)).toBeLessThanOrEqual(2)
    // caption buttons: the overlay region right of the title bar area is inside the viewport
    expect(g.page.wcoVisible).toBe(true)
    const ta = g.page.titlebarArea!
    expect(ta.y).toBeGreaterThanOrEqual(0)
    expect(ta.x + ta.width).toBeLessThan(g.page.inner.w) // buttons occupy [ta.right, inner.w]
    expect(g.page.inner.w - (ta.x + ta.width)).toBeGreaterThanOrEqual(90) // room for min / max / close
    // sidebar bottom (设置 / 关于) fully visible
    expect(g.page.nav!.bottom).toBeLessThanOrEqual(g.page.inner.h)
    expect(g.page.nav!.x).toBeGreaterThanOrEqual(0)
    await expect(page.getByRole('button', { name: /设置/ }).last()).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: /关于/ }).last()).toBeInViewport({ ratio: 1 })
    // restore brings back the normal size inside the work area
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize())
    await expect.poll(async () => (await geometry()).maximized).toBe(false)
    const r = await geometry()
    expect(r.content.width).toBeLessThan(wa.width + 1)
  })
}
