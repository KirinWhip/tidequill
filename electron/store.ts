import fs from 'node:fs'
import path from 'node:path'

/** Local JSON store hardening (Round 2 · D, item 23):
 *  - atomic writes: write <file>.tmp, fsync, rename over the target (a crash leaves either the old or the new file)
 *  - rotating backups: userData/backups/<key>/<timestamp>.json, newest BACKUP_COUNT kept, written at startup and
 *    at most every BACKUP_INTERVAL_MS per key while the app runs (only when the content changed)
 *  - corruption detection: a file that does not parse, or whose top-level type is wrong, is moved aside to
 *    <key>.corrupt-<timestamp>.json and the newest valid backup is restored; a notice is recorded for the UI */
export const BACKUP_COUNT = 5
export const BACKUP_INTERVAL_MS = 10 * 60_000
const ARRAY_KEYS = new Set(['conversations', 'personas', 'prompts', 'gallery', 'folders'])

export interface StorageNotice { key: string; kind: 'restored' | 'reset'; backup?: string; corruptFile: string; at: number }

export function validShape(key: string, v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (ARRAY_KEYS.has(key)) return Array.isArray(v)
  return typeof v === 'object' && !Array.isArray(v)
}

export function atomicWrite(file: string, text: string) {
  const tmp = file + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeSync(fd, text); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
}

const stamp = (now: number) => new Date(now).toISOString().replace(/[:.]/g, '-')

export class JsonStore {
  notices: StorageNotice[] = []
  private lastBackup = new Map<string, number>()
  constructor(private dataDir: string, private backupDir: string, private count = BACKUP_COUNT, private interval = BACKUP_INTERVAL_MS) {}

  file(key: string) { return path.join(this.dataDir, key + '.json') }
  backupsOf(key: string): string[] {
    const d = path.join(this.backupDir, key)
    try { return fs.readdirSync(d).filter(f => f.endsWith('.json')).sort().reverse().map(f => path.join(d, f)) } catch { return [] }
  }

  /** copy the current (valid) file into the rotation; skipped when unchanged since the newest backup */
  backup(key: string, now = Date.now()): string | null {
    let text: string
    try { text = fs.readFileSync(this.file(key), 'utf8') } catch { return null }
    try { if (!validShape(key, JSON.parse(text))) return null } catch { return null }
    this.lastBackup.set(key, now)
    const existing = this.backupsOf(key)
    if (existing[0]) { try { if (fs.readFileSync(existing[0], 'utf8') === text) return null } catch { /* rewrite */ } }
    const d = path.join(this.backupDir, key); fs.mkdirSync(d, { recursive: true })
    let target = path.join(d, stamp(now) + '.json'); let i = 1
    while (fs.existsSync(target)) target = path.join(d, `${stamp(now)}-${i++}.json`)
    atomicWrite(target, text)
    for (const old of this.backupsOf(key).slice(this.count)) fs.rmSync(old, { force: true })
    return target
  }
  maybeBackup(key: string, now = Date.now()) {
    if (now - (this.lastBackup.get(key) ?? 0) >= this.interval) this.backup(key, now)
  }

  /** read a key; on corruption restore the newest valid backup (or reset) and record a notice */
  read(key: string, now = Date.now()): any {
    const f = this.file(key)
    let text: string
    try { text = fs.readFileSync(f, 'utf8') } catch { return undefined } // missing: first run
    try { const v = JSON.parse(text); if (validShape(key, v)) return v } catch { /* corrupt */ }
    const corruptFile = path.join(this.dataDir, `${key}.corrupt-${stamp(now)}.json`)
    fs.renameSync(f, corruptFile)
    for (const b of this.backupsOf(key)) {
      try {
        const bt = fs.readFileSync(b, 'utf8'); const v = JSON.parse(bt)
        if (!validShape(key, v)) continue
        atomicWrite(f, bt)
        this.notices.push({ key, kind: 'restored', backup: path.basename(b), corruptFile: path.basename(corruptFile), at: now })
        return v
      } catch { /* try older */ }
    }
    this.notices.push({ key, kind: 'reset', corruptFile: path.basename(corruptFile), at: now })
    return undefined
  }

  write(key: string, v: unknown, now = Date.now()) {
    atomicWrite(this.file(key), JSON.stringify(v))
    this.maybeBackup(key, now)
  }
}
