import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Strict CSP injected into the production index.html (dev server needs inline HMR scripts, so it's build-only).
 *  No network access from the renderer at all: provider requests go through the main process. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // KaTeX / Mermaid emit inline styles
  "img-src 'self' data: blob: https:", // generated images may be remote https URLs
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ')

const csp = (): Plugin => ({
  name: 'csp', apply: 'build',
  transformIndexHtml: html => html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

export default defineConfig({
  plugins: [react(), csp()],
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 5000 },
  server: { port: 5173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as any)
