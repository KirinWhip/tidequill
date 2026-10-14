import { randomToken } from './random'
/** Speech-to-text through an OpenAI-compatible POST {baseURL}/audio/transcriptions (multipart/form-data).
 *  Works with OpenAI (whisper-1, gpt-4o-mini-transcribe, gpt-4o-transcribe) and compatible servers
 *  (e.g. Groq, a local faster-whisper / LocalAI server). The request goes through the main-process bridge. */
import type { ProviderConfig } from './types'

export interface SttConfig { enabled: boolean; providerId: string; model: string; language: string }
export const DEFAULT_STT: SttConfig = { enabled: false, providerId: '', model: 'whisper-1', language: '' }

const enc = new TextEncoder()
/** builds a multipart body as bytes (the bridge carries a Uint8Array body to the main process) */
export function buildMultipart(fields: Record<string, string>, file: { name: string; type: string; data: Uint8Array }, boundary = 'tq' + randomToken(12)): { body: Uint8Array; contentType: string } {
  const chunks: Uint8Array[] = []
  for (const [k, v] of Object.entries(fields)) if (v) chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`))
  chunks.push(file.data)
  chunks.push(enc.encode(`\r\n--${boundary}--\r\n`))
  const body = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
  let o = 0; for (const c of chunks) { body.set(c, o); o += c.length }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

export function sttEndpoint(p: ProviderConfig) { return (p.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/audio/transcriptions' }

export async function transcribe(p: ProviderConfig, cfg: SttConfig, audio: { data: Uint8Array; type: string }, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<string> {
  const ext = /ogg/.test(audio.type) ? 'ogg' : /mp4|m4a/.test(audio.type) ? 'm4a' : /wav/.test(audio.type) ? 'wav' : 'webm'
  const { body, contentType } = buildMultipart({ model: cfg.model || 'whisper-1', language: cfg.language, response_format: 'json' }, { name: `speech.${ext}`, type: audio.type.split(';')[0] || 'audio/webm', data: audio.data })
  const headers: Record<string, string> = { 'Content-Type': contentType }
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`
  const res = await fetchImpl(sttEndpoint(p), { method: 'POST', headers, body: body as any, signal })
  const text = await res.text()
  if (!res.ok) { let m = text.slice(0, 300); try { m = JSON.parse(text).error?.message || m } catch { /* raw */ } throw new Error(`HTTP ${res.status} ${m}`) }
  try { return String(JSON.parse(text).text ?? '').trim() } catch { return text.trim() }
}
