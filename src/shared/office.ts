/** Text extraction from .xlsx / .pptx (Office Open XML = zip of XML parts).
 *  Uses fflate (MIT) to unzip and a small tag scanner instead of a full spreadsheet library:
 *  values, shared strings, sheet names and slide text are enough to give the model the content.
 *  Not supported: formulas are not evaluated (the cached value saved by Excel is used; files without one show the formula), charts, images, .xls/.ppt (binary formats). */
import { unzipSync, strFromU8 } from 'fflate'

const decode = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
  e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)))
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
/** concatenated text of all <t> / <a:t> runs inside a fragment */
const runs = (xml: string, tag = 't') => { let s = ''; const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'); let m; while ((m = re.exec(xml))) s += decode(m[1]); return s }

function unzip(data: Uint8Array, filter: (name: string) => boolean): Record<string, string> {
  let files: Record<string, Uint8Array>
  try { files = unzipSync(data, { filter: f => filter(f.name) }) } catch { throw new Error('not a valid Office (zip) file') }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(files)) out[k] = strFromU8(v)
  return out
}

/** column letters -> 0-based index (A=0, Z=25, AA=26) */
export const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }

export interface XlsxOptions { maxRowsPerSheet?: number }
export function xlsxToText(data: Uint8Array, opt: XlsxOptions = {}): string {
  const maxRows = opt.maxRowsPerSheet ?? 2000
  const f = unzip(data, n => n === 'xl/workbook.xml' || n === 'xl/sharedStrings.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  if (!f['xl/workbook.xml']) throw new Error('not an .xlsx workbook')
  const shared: string[] = []
  const ss = f['xl/sharedStrings.xml'] || ''
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(runs(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')))
  const rels = new Map<string, string>()
  for (const m of (f['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship\b[^>]*>/g)) { const id = attr(m[0], 'Id'), t = attr(m[0], 'Target'); if (id && t) rels.set(id, 'xl/' + t.replace(/^\/?xl\//, '').replace(/^\//, '')) }
  const sheets = [...f['xl/workbook.xml'].matchAll(/<sheet\b[^>]*>/g)].map((m, i) => ({
    name: decode(attr(m[0], 'name') || `Sheet${i + 1}`),
    path: rels.get(attr(m[0], 'r:id') || '') || `xl/worksheets/sheet${i + 1}.xml`,
  }))
  const out: string[] = []
  for (const sh of sheets) {
    const xml = f[sh.path]
    if (!xml) continue
    const rows: string[] = []
    let truncated = false
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= maxRows) { truncated = true; break }
      const cells: string[] = []
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = ' ' + cm[1], body = cm[2] || ''
        const ref = attr(a, 'r'), t = attr(a, 't')
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
        const fx = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1]
        let val = !v && fx ? '=' + decode(fx) : t === 's' ? (shared[Number(v)] ?? '') : t === 'inlineStr' ? runs(body) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : decode(v ?? '')
        val = val.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
        const idx = ref ? colIndex(ref) : cells.length
        while (cells.length < idx) cells.push('')
        cells[idx] = val
      }
      if (cells.some(c => c !== '')) rows.push(cells.join('\t'))
    }
    out.push(`## ${sh.name}\n${rows.join('\n')}${truncated ? `\n… (${maxRows}+ rows, truncated)` : ''}`)
  }
  return out.join('\n\n')
}

export function pptxToText(data: Uint8Array): string {
  const f = unzip(data, n => /^ppt\/slides\/slide\d+\.xml$/.test(n) || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n) || /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(n) || n === 'ppt/presentation.xml')
  if (!f['ppt/presentation.xml'] && !Object.keys(f).length) throw new Error('not a .pptx presentation')
  const num = (k: string) => Number(/(\d+)\.xml$/.exec(k)?.[1] || 0)
  const slides = Object.keys(f).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => num(a) - num(b))
  const para = (xml: string) => [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(m => runs(m[1], 'a:t').trim()).filter(Boolean)
  return slides.map(k => {
    const n = num(k)
    // the notes page of a slide is found through the slide's relationships, not by number
    const target = /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(f[`ppt/slides/_rels/slide${n}.xml.rels`] || '')?.[1]
    const notes = target ? f[`ppt/notesSlides/${target}`] : undefined
    const noteText = notes ? para(notes).filter(x => !/^\d+$/.test(x)) : []
    return `## Slide ${n}\n${para(f[k]).join('\n')}${noteText.length ? `\n[notes] ${noteText.join(' ')}` : ''}`
  }).join('\n\n')
}

/** human readable size */
export const fmtBytes = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`
