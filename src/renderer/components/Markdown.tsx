import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import { useT } from '../i18n'

/** sanitize any HTML/SVG before it is injected into the DOM */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true }, ADD_TAGS: ['foreignObject'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed'], FORBID_ATTR: ['onerror', 'onload', 'onclick'] })
}

let mid = 0
function Mermaid({ code, dark }: { code: string; dark: boolean }) {
  const [svg, setSvg] = useState(''); const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false } } as any)
    const t = setTimeout(() => {
      mermaid.render('mmd' + mid++, code).then(r => alive && (setSvg(sanitizeSvg(r.svg)), setErr(''))).catch(e => alive && setErr(String(e?.message || e)))
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [code, dark])
  if (err) return <pre className="mermaid-err">{code}</pre>
  return <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
}

function CodeBlock({ children, className }: any) {
  const t = useT()
  const ref = useRef<HTMLElement>(null)
  const [ok, setOk] = useState(false)
  const lang = /language-(\w+)/.exec(className || '')?.[1]
  return (
    <div className="codeblock">
      <div className="codebar"><span>{lang || t.codeFallback}</span>
        <button title={t.copyCode} onClick={() => { navigator.clipboard.writeText(ref.current?.innerText || ''); setOk(true); setTimeout(() => setOk(false), 1200) }}>{ok ? '✓' : '⧉'}</button>
      </div>
      <pre><code ref={ref} className={className}>{children}</code></pre>
    </div>
  )
}

const textOf = (c: any): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map(textOf).join('') : c?.props ? textOf(c.props.children) : ''
const safeUrl = (u: string) => { const v = defaultUrlTransform(u); return /^(https?:|mailto:|#|data:image\/)/i.test(v) ? v : '' }

/** Raw HTML in markdown is NOT rendered (no rehype-raw): it is shown as text. URLs are filtered to http(s)/mailto. */
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
          if (cls.includes('language-mermaid')) return <Mermaid code={textOf(child.props.children)} dark={dark} />
          return <CodeBlock className={cls}>{child?.props?.children}</CodeBlock>
        },
        a: ({ href, children }: any) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
      }}
    >{text.replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `$$${m}$$`).replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => `$${m}$`)}</ReactMarkdown>
  )
})
