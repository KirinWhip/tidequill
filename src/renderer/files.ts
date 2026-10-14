import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
// @ts-ignore
import mammoth from 'mammoth/mammoth.browser'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export const readAsDataURL = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f) })

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i)
      const c = await p.getTextContent()
      pages.push(c.items.map((it: any) => it.str).join(' '))
    }
    return pages.join('\n\n')
  }
  if (name.endsWith('.docx')) {
    const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return r.value
  }
  return await file.text()
}
