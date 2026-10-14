import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
// @ts-ignore
import mammoth from 'mammoth/mammoth.browser'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
import { xlsxToText, pptxToText } from '../shared/office'
import type { Attachment } from '../shared/types'

export const readAsDataURL = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f) })

export function kindOf(name: string): NonNullable<Attachment['kind']> {
  const n = name.toLowerCase()
  return n.endsWith('.pdf') ? 'pdf' : n.endsWith('.docx') ? 'docx' : n.endsWith('.xlsx') ? 'xlsx' : n.endsWith('.pptx') ? 'pptx' : 'text'
}

/** legacy binary Office formats are not supported (only the zip based .xlsx / .pptx / .docx) */
export const UNSUPPORTED = /\.(xls|ppt|doc)$/i

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) return xlsxToText(new Uint8Array(await file.arrayBuffer()))
  if (name.endsWith('.pptx')) return pptxToText(new Uint8Array(await file.arrayBuffer()))
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
