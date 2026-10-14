import { api } from '../api'
import { memo, useEffect, useRef, useState, createContext, useContext } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import { Check, ChevronDown, ChevronUp, Copy, Download, Maximize2, X } from 'lucide-react'
import { useT } from '../i18n'

export interface MdOptions { lineNumbers: boolean; collapseLines: number }
export const MdOptionsCtx = createContext<MdOptions>({ lineNumbers: false, collapseLines: 30 })

/** sanitize any HTML/SVG before it is injected into the DOM */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true }, ADD_TAGS: ['foreignObject'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed'], FORBID_ATTR: ['onerror', 'onload', 'onclick'] })
}

export function useCopy(): [boolean, (s: string) => void] {
  const [ok, setOk] = useState(false)
  return [ok, (s: string) => { api.copyText(s); setOk(true); setTimeout(() => setOk(false), 1500) }]
}

function downloadText(name: string, text: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

let mid = 0
function Mermaid({ code, dark }: { code: string; dark: boolean }) {
  const t = useT()
  const [svg, setSvg] = useState(''); const [err, setErr] = useState(''); const [zoom, setZoom] = useState(false)
  const [copied, copy] = useCopy()
  useEffect(() => {
    let alive = true
    mermaid.initialize({
      startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict', htmlLabels: false,
      flowchart: { htmlLabels: false, padding: 16, diagramPadding: 24, nodeSpacing: 50, rankSpacing: 60, useMaxWidth: true, curve: 'basis' },
      sequence: { diagramMarginX: 24, diagramMarginY: 16 },
      themeVariables: { fontSize: '15px' },
    } as any)
    const tm = setTimeout(() => {
      mermaid.render('mmd' + mid++, code).then(r => alive && (setSvg(sanitizeSvg(r.svg)), setErr(''))).catch(e => alive && setErr(String(e?.message || e)))
    }, 300)
    return () => { alive = false; clearTimeout(tm) }
  }, [code, dark])
  if (err) return <pre className="mermaid-err">{code}</pre>
  return (
    <div className="mermaid-wrap">
      <div className="mermaid-bar">
        <span>{t.mermaidLabel}</span>
        <span className="spacer" />
        <button className="icon-btn sm" title={t.mermaidZoom} aria-label={t.mermaidZoom} onClick={() => setZoom(true)}><Maximize2 size={14} /></button>
        <button className="icon-btn sm" title={copied ? t.copied : t.mermaidCopy} aria-label={t.mermaidCopy} onClick={() => copy(code)}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
        <button className="icon-btn sm" title={t.mermaidDownload} aria-label={t.mermaidDownload} onClick={() => downloadText('diagram.svg', svg, 'image/svg+xml')}><Download size={14} /></button>
      </div>
      <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
      {zoom && <div className="overlay" onClick={() => setZoom(false)}>
        <div className="zoombox" onClick={e => e.stopPropagation()}>
          <button className="icon-btn close" title={t.close} aria-label={t.close} onClick={() => setZoom(false)}><X size={18} /></button>
          <div className="mermaid zoomed" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>}
    </div>
  )
}

function CodeBlock({ children, className, raw }: any) {
  const t = useT()
  const opt = useContext(MdOptionsCtx)
  const [copied, copy] = useCopy()
  const lang = /language-([\w+-]+)/.exec(className || '')?.[1]
  const lineCount = raw.replace(/\n$/, '').split('\n').length
  const long = opt.collapseLines > 0 && lineCount > opt.collapseLines
  const [open, setOpen] = useState(!long)
  return (
    <div className={'codeblock' + (opt.lineNumbers ? ' numbered' : '') + (!open ? ' collapsed' : '')}>
      <div className="codebar">
        <span className="lang">{lang || t.codeFallback}</span>
        <span className="spacer" />
        <button className={'copybtn' + (copied ? ' ok' : '')} title={t.copyCode} aria-label={t.copyCode} onClick={() => copy(raw.replace(/\n$/, ''))}>
          {copied ? <Check size={14} /> : <Copy size={14} />}<span>{copied ? t.copied : t.copy}</span>
        </button>
      </div>
      <div className="codebody">
        {opt.lineNumbers && <div className="gutter" aria-hidden>{Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}</div>}
        <pre><code className={className}>{children}</code></pre>
      </div>
      {long && <button className="codetoggle" onClick={() => setOpen(!open)}>
        {open ? <><ChevronUp size={14} />{t.collapseCode}</> : <><ChevronDown size={14} />{t.expandCode} ({lineCount} {t.lines})</>}
      </button>}
    </div>
  )
}

const textOf = (c: any): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map(textOf).join('') : c?.props ? textOf(c.props.children) : ''
const safeUrl = (u: string) => { const v = defaultUrlTransform(u); return /^(https?:|mailto:|#|data:image\/)/i.test(v) ? v : '' }

/** Raw HTML in markdown is NOT rendered (skipHtml). URLs are filtered to http(s)/mailto. */
export const Markdown = memo(function Markdown({ text, dark }: { text: string; dark: boolean }) {
  return (
    <ReactMarkdown
      skipHtml
      urlTransform={safeUrl}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={{
        pre: ({ children }: any) => {
          const child = Array.isArray(children) ? children[0] : children
          const cls = child?.props?.className || ''
          const raw = textOf(child?.props?.children)
          if (cls.includes('language-mermaid')) return <Mermaid code={raw} dark={dark} />
          return <CodeBlock className={cls} raw={raw}>{child?.props?.children}</CodeBlock>
        },
        table: ({ children }: any) => <div className="tablewrap"><table>{children}</table></div>,
        a: ({ href, children }: any) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
      }}
    >{text.replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `$$${m}$$`).replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => `$${m}$`)}</ReactMarkdown>
  )
})
