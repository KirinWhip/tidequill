// Round 2 · C: web search, citations, key encryption, xlsx/pptx extraction, STT multipart, find
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
// @ts-ignore
import { startMockServer, SEARCH_RESULTS, TRANSCRIPT } from './mock-server.mjs'
import { runBridgeRequest } from '../electron/http'
import { createBridgeFetch } from '../src/renderer/api'
import { webSearch, linkCitations, searchContext, SearchError, DEFAULT_WEB_SEARCH, type WebSearchConfig } from '../src/shared/websearch'
import { encryptSettings, decryptSettings, ENC_PREFIX, type Cipher } from '../electron/secrets'
import { scrubSettings, restoreSettings } from '../src/shared/sync'
import { xlsxToText, pptxToText, colIndex } from '../src/shared/office'
import { buildMultipart, transcribe } from '../src/shared/stt'
import { findAll, step } from '../src/shared/find'
import { defaultSettings } from '../src/shared/storage'
import { zipSync, strToU8 } from 'fflate'

let srv: any
beforeAll(async () => { srv = await startMockServer() })
afterAll(async () => { await srv.close() })
const base = () => srv.url.replace(/\/v1$/, '')
const bridge = () => createBridgeFetch((id, req, ev) => runBridgeRequest(fetch, req, ev, new AbortController().signal), () => {}, () => {}, () => 3000)
const cfg = (p: Partial<WebSearchConfig>): WebSearchConfig => ({ ...DEFAULT_WEB_SEARCH, enabled: true, endpoints: { tavily: base() + '/search/tavily', bing: base() + '/bing/v7.0/search', brave: base() + '/brave/res/v1/web/search' }, ...p })

describe('web search providers (mock APIs through the bridge)', () => {
  for (const [provider, extra] of [['tavily', { tavilyKey: 'tvly-test' }], ['searxng', {}], ['bing', { bingKey: 'bing-k' }], ['brave', { braveKey: 'brv-k' }]] as const) {
    it(`${provider}: normalized citations`, async () => {
      const c = cfg({ provider, maxResults: 2, ...extra, ...(provider === 'searxng' ? { searxngUrl: base() + '/searxng' } : {}) })
      const r = await webSearch(c, '潮汐 为什么', bridge())
      expect(r).toHaveLength(2)
      expect(r[0]).toMatchObject({ n: 1, title: SEARCH_RESULTS[0].title, url: SEARCH_RESULTS[0].url })
      expect(r[1].snippet).not.toContain('<strong>')
      const last = srv.searches.at(-1)
      expect(last.provider).toBe(provider); expect(last.query).toBe('潮汐 为什么')
    })
  }
  it('sends the key in the provider-specific header', () => {
    const by = (p: string) => srv.searches.find((x: any) => x.provider === p)
    expect(by('tavily').auth).toBe('Bearer tvly-test'); expect(by('bing').key).toBe('bing-k'); expect(by('brave').key).toBe('brv-k')
    expect(by('searxng').format).toBe('json'); expect(by('tavily').max).toBe(2)
  })
  it('errors: missing key, bad key (HTTP), unreachable', async () => {
    await expect(webSearch(cfg({ provider: 'tavily' }), 'x', bridge())).rejects.toMatchObject({ code: 'nokey' })
    await expect(webSearch(cfg({ provider: 'searxng' }), 'x', bridge())).rejects.toMatchObject({ code: 'nourl' })
    const e = await webSearch(cfg({ provider: 'tavily', tavilyKey: 'wrong' }), 'x', bridge()).catch(x => x)
    expect(e).toBeInstanceOf(SearchError); expect(e.code).toBe('http'); expect(e.message).toContain('401'); expect(e.message).toContain('invalid API key')
    const n = await webSearch(cfg({ provider: 'brave', braveKey: 'k', endpoints: { brave: 'http://127.0.0.1:9/x' } }), 'x', bridge()).catch(x => x)
    expect(n.code).toBe('network')
  })
  it('search context and citation links', () => {
    const cites = SEARCH_RESULTS.map((r: any, i: number) => ({ n: i + 1, title: r.title, url: r.url, snippet: r.content }))
    const ctx = searchContext(cites, '潮汐', 'zh')
    expect(ctx).toContain('<web_search>'); expect(ctx).toContain('[2] ' + cites[1].title); expect(ctx).toContain(cites[2].url)
    const md = linkCitations('A [1]. B [2, 3]. Not [9]. `code [1]`\n```\n[1]\n```', cites)
    expect(md).toContain(`[\\[1\\]](<${cites[0].url}> "cite-1")`)
    expect(md).toContain('"cite-2")[\\[3\\]]')
    expect(md).toContain('Not [9]'); expect(md).toContain('`code [1]`'); expect(md).toContain('```\n[1]\n```')
  })
})

describe('search keys: encryption at rest and backups', () => {
  const rot: Cipher = { available: () => true, encrypt: s => Buffer.from(s).reverse().toString('base64'), decrypt: s => Buffer.from(s, 'base64').reverse().toString() }
  const s = { providers: [], webSearch: { ...DEFAULT_WEB_SEARCH, tavilyKey: 'tvly-secret', braveKey: 'brv-secret', bingKey: '' } }
  it('encrypted with safeStorage, round-trips, migrates plaintext', () => {
    const e = encryptSettings(s, rot)
    expect(JSON.stringify(e)).not.toContain('tvly-secret'); expect(e.webSearch.tavilyKey.startsWith(ENC_PREFIX)).toBe(true); expect(e.webSearch.bingKey).toBe('')
    const d = decryptSettings(e, rot)
    expect(d.settings.webSearch.tavilyKey).toBe('tvly-secret'); expect(d.needsMigration).toBe(false)
    expect(decryptSettings(s, rot).needsMigration).toBe(true)
  })
  it('backup without keys strips them; restore keeps the current ones', () => {
    const sc = scrubSettings(s)
    expect(JSON.stringify(sc)).not.toContain('secret')
    const r = restoreSettings(s, sc)
    expect(r.webSearch.tavilyKey).toBe('tvly-secret'); expect(r.webSearch.braveKey).toBe('brv-secret')
  })
  it('defaults: off, tavily, OCR and voice off, 20 MB limit', () => {
    const d = defaultSettings()
    expect(d.webSearch!.enabled).toBe(false); expect(d.ocr!.enabled).toBe(false); expect(d.stt!.enabled).toBe(false); expect(d.maxAttachmentMB).toBe(20)
  })
})

describe('xlsx / pptx text extraction', () => {
  const xlsx = new Uint8Array(fs.readFileSync('tests/fixtures/sample.xlsx')) // written by openpyxl
  const pptx = new Uint8Array(fs.readFileSync('tests/fixtures/sample.pptx')) // written by python-pptx
  it('xlsx: sheet names, shared strings, numbers, booleans, escaped text, formulas without cached value', () => {
    const t = xlsxToText(xlsx)
    expect(t).toContain('## 季度销售'); expect(t).toContain('## Notes')
    expect(t).toContain('地区\tQ1\tQ2\t合计'); expect(t).toContain('华南\t98\t110.5\t=B3+C3')
    expect(t).toContain('备注 & <说明>'); expect(t).toMatch(/\t\tTRUE/)
  })
  it('xlsx: inline strings, sparse columns, row limit', () => {
    const sheet = `<worksheet><sheetData>${Array.from({ length: 5 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>r${i}</t></is></c><c r="C${i + 1}"><v>${i}</v></c></row>`).join('')}</sheetData></worksheet>`
    const z = zipSync({ 'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="S&amp;1" sheetId="1" r:id="rId1"/></sheets></workbook>'), 'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'), 'xl/worksheets/sheet1.xml': strToU8(sheet) })
    const t = xlsxToText(z, { maxRowsPerSheet: 3 })
    expect(t).toContain('## S&1'); expect(t).toContain('r0\t\t0'); expect(t).not.toContain('r3'); expect(t).toContain('truncated')
    expect(colIndex('A1')).toBe(0); expect(colIndex('AA10')).toBe(26)
  })
  it('pptx: slides in order with notes', () => {
    const t = pptxToText(pptx)
    expect(t.indexOf('## Slide 1')).toBeLessThan(t.indexOf('## Slide 2'))
    expect(t).toContain('潮笺 季度回顾'); expect(t).toContain('[notes] 演讲者备注：先讲结论'); expect(t).toContain('新增用户 3.4 万')
  })
  it('rejects non-zip data', () => { expect(() => xlsxToText(new Uint8Array([1, 2, 3]))).toThrow(/valid Office/) })
})

describe('speech to text', () => {
  it('multipart body is well formed', () => {
    const { body, contentType } = buildMultipart({ model: 'whisper-1', language: '' }, { name: 'a.webm', type: 'audio/webm', data: new Uint8Array([0, 1, 2, 255]) }, 'BND')
    const s = Buffer.from(body).toString('latin1')
    expect(contentType).toBe('multipart/form-data; boundary=BND')
    expect(s).toContain('name="model"\r\n\r\nwhisper-1\r\n'); expect(s).not.toContain('name="language"')
    expect(s).toContain('filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n\x00\x01\x02\xff\r\n--BND--')
  })
  it('binary body goes through the bridge to /audio/transcriptions', async () => {
    const p = { id: 'm', name: 'M', type: 'openai' as const, apiKey: 'sk-stt', baseURL: srv.url, models: [] }
    const text = await transcribe(p, { enabled: true, providerId: 'm', model: 'gpt-4o-mini-transcribe', language: 'zh' }, { data: new Uint8Array(5000).fill(7), type: 'audio/webm;codecs=opus' }, bridge())
    expect(text).toBe(TRANSCRIPT)
    expect(srv.transcriptions.at(-1)).toMatchObject({ contentType: 'multipart/form-data', model: 'gpt-4o-mini-transcribe', language: 'zh', fileName: 'speech.webm', fileType: 'audio/webm', fileBytes: 5000, auth: 'Bearer sk-stt' })
  })
})

describe('find in conversation', () => {
  it('case-insensitive, non-overlapping, empty query', () => {
    expect(findAll('Tide tide TIDE', 'tide')).toEqual([0, 5, 10]); expect(findAll('aaaa', 'aa')).toEqual([0, 2]); expect(findAll('abc', '')).toEqual([])
    expect(findAll('潮汐与潮汐', '潮汐')).toEqual([0, 3])
    expect(step(2, 3, 1)).toBe(0); expect(step(0, 3, -1)).toBe(2); expect(step(0, 0, 1)).toBe(-1)
  })
})
