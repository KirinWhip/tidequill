import type { WebDavConfig } from '../shared/types'
import { ProviderError } from '../shared/errors'
import { bridgeFetch } from './api'

const FILE = 'chatbox-sync.json'
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const dir = (c: WebDavConfig) => c.url.replace(/\/*$/, '/')
const headers = (c: WebDavConfig, extra: Record<string, string> = {}) => ({ ...(c.username ? { Authorization: 'Basic ' + b64(`${c.username}:${c.password}`) } : {}), ...extra })

async function req(c: WebDavConfig, method: string, url: string, body?: string, extra?: Record<string, string>) {
  const r = await bridgeFetch(url, { method, headers: headers(c, extra), body })
  return r
}

/** check credentials; create the folder if it does not exist */
export async function webdavTest(c: WebDavConfig): Promise<void> {
  let r = await req(c, 'PROPFIND', dir(c), undefined, { Depth: '0' })
  if (r.status === 404) { const m = await req(c, 'MKCOL', dir(c)); if (m.status >= 300) throw new ProviderError('http', `MKCOL ${m.status}`, m.status); r = await req(c, 'PROPFIND', dir(c), undefined, { Depth: '0' }) }
  if (r.status === 401 || r.status === 403) throw new ProviderError('auth', `WebDAV ${r.status}`, r.status)
  if (r.status >= 300) throw new ProviderError('http', `WebDAV ${r.status}`, r.status)
}

export async function webdavGet(c: WebDavConfig): Promise<any | null> {
  const r = await req(c, 'GET', dir(c) + FILE)
  if (r.status === 404) return null
  if (r.status === 401 || r.status === 403) throw new ProviderError('auth', `WebDAV ${r.status}`, r.status)
  if (!r.ok) throw new ProviderError('http', `WebDAV GET ${r.status}`, r.status)
  return JSON.parse(await r.text())
}

export async function webdavPut(c: WebDavConfig, data: any): Promise<void> {
  const r = await req(c, 'PUT', dir(c) + FILE, JSON.stringify(data), { 'Content-Type': 'application/json' })
  if (r.status === 401 || r.status === 403) throw new ProviderError('auth', `WebDAV ${r.status}`, r.status)
  if (r.status >= 300) throw new ProviderError('http', `WebDAV PUT ${r.status}`, r.status)
}
