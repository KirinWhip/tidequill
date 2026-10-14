/** Optional image OCR with tesseract.js. Runs in a web worker; worker and wasm core are local files in dist/ocr,
 *  language data comes from userData/ocr through the tqocr: protocol (downloaded once in Settings > Chat). */
import { createWorker, type Worker } from 'tesseract.js'

let worker: Worker | null = null
let workerLangs = ''

export async function ocrImage(image: Blob | string, langs: string[], onProgress?: (p: number) => void): Promise<string> {
  const key = langs.join('+')
  if (!worker || workerLangs !== key) {
    await worker?.terminate().catch(() => {})
    const base = new URL('./ocr/', location.href).href
    worker = await createWorker(langs, 1, {
      workerPath: base + 'worker.min.js', corePath: base, workerBlobURL: false,
      langPath: 'tqocr://lang', cacheMethod: 'none', gzip: true,
      logger: m => { if (m.status === 'recognizing text') onProgress?.(m.progress) },
    })
    workerLangs = key
  }
  const r = await worker.recognize(image as any)
  return r.data.text.trim()
}
