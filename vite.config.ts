import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'

/** Strict CSP injected into the production index.html (dev server needs inline HMR scripts, so it's build-only).
 *  No network access from the renderer at all: provider requests go through the main process. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // KaTeX / Mermaid emit inline styles
  "img-src 'self' data: blob: https:", // generated images may be remote https URLs
  "font-src 'self' data:",
  "connect-src 'self' data: blob: tqocr:", // tqocr: OCR language data served by the main process
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src tqpreview:", // only sandboxed HTML/SVG previews (see electron/main.ts)
].join('; ')

const csp = (): Plugin => ({
  name: 'csp', apply: 'build',
  transformIndexHtml: html => html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

/** OCR (tesseract.js) runs in a web worker; the worker script and the wasm core are shipped locally in dist/ocr,
 *  nothing is loaded from a CDN. Only the LSTM cores are copied (the app always uses OEM 1 = LSTM). */
export const OCR_ASSETS: [string, string][] = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
]
const ocrAssets = (): Plugin => ({
  name: 'ocr-assets', apply: 'build',
  writeBundle(o) {
    const dir = (o.dir || 'dist') + '/ocr'
    fs.mkdirSync(dir, { recursive: true })
    for (const [src, dst] of OCR_ASSETS) fs.copyFileSync(src, `${dir}/${dst}`)
  },
})

/** records which node_modules files end up in the renderer bundle (input for THIRD_PARTY_NOTICES) */
const bundledModules = (): Plugin => ({
  name: 'bundled-modules', apply: 'build',
  generateBundle(_o, bundle) {
    const ids = new Set<string>()
    for (const c of Object.values(bundle)) if (c.type === 'chunk') for (const id of Object.keys(c.modules)) ids.add(id)
    fs.mkdirSync('build-meta', { recursive: true })
    fs.writeFileSync('build-meta/renderer-modules.json', JSON.stringify([...ids]))
  },
})

export default defineConfig({
  plugins: [react(), csp(), bundledModules(), ocrAssets()],
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 5000 },
  server: { port: 5173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as any)
