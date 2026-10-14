/** Fails if UI code contains hardcoded user-visible strings instead of going through the language packs. */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { zhCN } from '../src/renderer/locales/zh-CN'
import { en } from '../src/renderer/locales/en'
import { resolveLang } from '../src/renderer/i18n'
import { mainStrings } from '../electron/i18n'

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
// UI sources: every renderer file except the language packs, plus main-process files except electron/i18n.ts
const uiFiles = [...walk('src/renderer'), ...walk('electron')]
  .filter(f => /\.(tsx?|jsx?)$/.test(f) && !f.includes(`${path.sep}locales${path.sep}`) && !f.endsWith(path.join('electron', 'i18n.ts')))
const tsxFiles = uiFiles.filter(f => f.endsWith('.tsx'))
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
// tokens that are not translatable words (symbols, key names inside template literals, etc.)
const ALLOWED_TEXT = new Set(['✓', '⧉', '✕', '✎', '📌', '🗑', '⤓', '＋', '■', '➤', '💬', '🧠', '📎', '📚', '🎭', '🎨', '🧩', '📥', '📤', '⚙️', '🔧', '📄', '⚠', '🧑', '🤖', '▍'])

describe('i18n', () => {
  it('language packs have identical keys and no empty values', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort())
    for (const [k, v] of [...Object.entries(zhCN), ...Object.entries(en)]) expect(v, k).not.toBe('')
    expect(Object.keys(mainStrings.en).sort()).toEqual(Object.keys(mainStrings.zh).sort())
  })

  it('no CJK characters in UI source files', () => {
    const bad: string[] = []
    for (const f of uiFiles) {
      stripComments(fs.readFileSync(f, 'utf8')).split('\n').forEach((l, i) => { if (/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/.test(l.replace(/'＋'|＋/g, ''))) bad.push(`${f}:${i + 1}: ${l.trim()}`) })
    }
    expect(bad).toEqual([])
  })

  it('no hardcoded English text in JSX, attributes, alert/confirm', () => {
    const bad: string[] = []
    for (const f of tsxFiles) {
      const src = stripComments(fs.readFileSync(f, 'utf8'))
      // JSX text between tags: >Some words<
      for (const m of src.matchAll(/>([^<>{}]+)</g)) {
        const txt = m[1].trim()
        if (/\b(return|const|let|if|else)\b/.test(txt)) continue
        if (txt && /[A-Za-z]{2,}/.test(txt) && !/[=;()]/.test(txt)) bad.push(`${f}: JSX text "${txt}"`)
        else if (txt && !/[A-Za-z]/.test(txt) && !ALLOWED_TEXT.has(txt) && /[^\s\d.,:;+\-()[\]=>'"`|&!?*/\\]/.test(txt) && !/[=;()]/.test(txt)) bad.push(`${f}: JSX symbol "${txt}" not in allowlist`)
      }
      // literal user-facing attributes
      for (const m of src.matchAll(/\b(placeholder|title|aria-label|alt|label|checkboxLabel)="([^"]*)"/g)) if (/[A-Za-z]{2,}/.test(m[2])) bad.push(`${f}: ${m[1]}="${m[2]}"`)
      for (const m of src.matchAll(/\b(alert|confirm|prompt)\(\s*(['"`])([A-Za-z][^'"`]*)\2/g)) bad.push(`${f}: ${m[1]}(${m[3]})`)
    }
    expect(bad).toEqual([])
  })

  it('every t.<key> used in UI exists in the language pack', () => {
    const missing: string[] = []
    for (const f of tsxFiles) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bt\.([a-zA-Z_]\w*)/g)) if (!(m[1] in zhCN)) missing.push(`${f}: t.${m[1]}`)
    expect(missing).toEqual([])
  })

  it('error codes all have messages', () => {
    for (const c of ['auth', 'rate_limit', 'timeout', 'network', 'disconnected', 'server', 'not_found', 'bad_request', 'http', 'unknown', 'aborted']) expect(`err_${c}` in zhCN, c).toBe(true)
  })

  it('resolves language from system locale with manual override', () => {
    expect(resolveLang('system', 'zh-CN')).toBe('zh'); expect(resolveLang('system', 'zh-TW')).toBe('zh')
    expect(resolveLang('system', 'en-US')).toBe('en'); expect(resolveLang('system', 'de')).toBe('en')
    expect(resolveLang('en', 'zh-CN')).toBe('en'); expect(resolveLang('zh', 'en-US')).toBe('zh')
  })
})
