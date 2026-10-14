import type { Conversation } from './types'

export const BACKUP_FORMAT = 'chatbox-clone-backup'
export interface Backup { format: string; version: number; createdAt: number; data: Record<string, any> }
export const BACKUP_KEYS = ['settings', 'conversations', 'personas', 'prompts', 'gallery', 'folders'] as const

/** strip secrets (API keys, WebDAV password) from settings unless explicitly included */
export function scrubSettings(s: any) {
  if (!s) return s
  return { ...s, providers: (s.providers || []).map((p: any) => ({ ...p, apiKey: '' })), webdav: s.webdav ? { ...s.webdav, password: '' } : s.webdav }
}

export function makeBackup(data: Record<string, any>, includeSecrets = false): Backup {
  const d = { ...data }
  if (!includeSecrets) d.settings = scrubSettings(d.settings)
  return { format: BACKUP_FORMAT, version: 1, createdAt: Date.now(), data: d }
}

export function parseBackup(text: string): Backup {
  const j = JSON.parse(text)
  if (j?.format !== BACKUP_FORMAT || typeof j.data !== 'object') throw new Error('invalid backup')
  return j
}

/** when restoring a backup without secrets, keep the current secrets */
export function restoreSettings(current: any, incoming: any) {
  if (!incoming) return current
  const providers = (incoming.providers || []).map((p: any) => ({ ...p, apiKey: p.apiKey || current?.providers?.find((c: any) => c.id === p.id)?.apiKey || '' }))
  return { ...incoming, providers, webdav: { ...(incoming.webdav || {}), password: incoming.webdav?.password || current?.webdav?.password || '' } }
}

/** merge conversations from two devices: union by id, newer updatedAt wins, deletions tracked by tombstones */
export function mergeConversations(local: Conversation[], remote: Conversation[], tombstones: Record<string, number> = {}): Conversation[] {
  const map = new Map<string, Conversation>()
  for (const c of [...local, ...remote]) {
    const prev = map.get(c.id)
    if (!prev || c.updatedAt > prev.updatedAt) map.set(c.id, c)
  }
  return [...map.values()].filter(c => !(tombstones[c.id] && tombstones[c.id] >= c.updatedAt))
}

export interface SyncPayload { format: string; version: number; updatedAt: number; conversations: Conversation[]; tombstones: Record<string, number>; folders: any[]; personas: any[]; prompts: any[] }
export function makeSyncPayload(p: Omit<SyncPayload, 'format' | 'version' | 'updatedAt'>): SyncPayload {
  return { format: 'chatbox-clone-sync', version: 1, updatedAt: Date.now(), ...p }
}
export function mergeSync(local: Omit<SyncPayload, 'format' | 'version' | 'updatedAt'>, remote: SyncPayload | null) {
  if (!remote) return local
  const tombstones = { ...remote.tombstones }
  for (const [k, v] of Object.entries(local.tombstones)) tombstones[k] = Math.max(v, tombstones[k] || 0)
  const byId = (a: any[], b: any[]) => { const m = new Map<string, any>(); for (const x of [...(b || []), ...(a || [])]) m.set(x.id, x); return [...m.values()] }
  return {
    conversations: mergeConversations(local.conversations, remote.conversations || [], tombstones),
    tombstones, folders: byId(local.folders, remote.folders), personas: byId(local.personas, remote.personas), prompts: byId(local.prompts, remote.prompts),
  }
}
