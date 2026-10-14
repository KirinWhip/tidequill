/** API-key encryption for the settings blob. `enc` is injectable for tests. */
export interface Cipher { available(): boolean; encrypt(s: string): string; decrypt(s: string): string }

export const ENC_PREFIX = 'enc:v1:'

/** returns a copy of settings with provider apiKeys encrypted */
export function encryptSettings(s: any, c: Cipher): any {
  if (!s?.providers || !c.available()) return s
  const enc = (v: string) => v && !String(v).startsWith(ENC_PREFIX) ? ENC_PREFIX + c.encrypt(v) : v
  const out = { ...s, providers: s.providers.map((p: any) => ({ ...p, apiKey: enc(p.apiKey) })) }
  if (s.webdav?.password) out.webdav = { ...s.webdav, password: enc(s.webdav.password) }
  return out
}

/** returns { settings with plaintext keys, needsMigration } */
export function decryptSettings(s: any, c: Cipher): { settings: any; needsMigration: boolean } {
  if (!s?.providers) return { settings: s, needsMigration: false }
  let needsMigration = false
  const providers = s.providers.map((p: any) => {
    const k = String(p.apiKey || '')
    if (!k) return p
    if (k.startsWith(ENC_PREFIX)) {
      try { return { ...p, apiKey: c.decrypt(k.slice(ENC_PREFIX.length)) } } catch { return { ...p, apiKey: '' } }
    }
    needsMigration = c.available()
    return p
  })
  const settings = { ...s, providers }
  const pw = String(s.webdav?.password || '')
  if (pw.startsWith(ENC_PREFIX)) { try { settings.webdav = { ...s.webdav, password: c.decrypt(pw.slice(ENC_PREFIX.length)) } } catch { settings.webdav = { ...s.webdav, password: '' } } }
  else if (pw && c.available()) needsMigration = true
  return { settings, needsMigration }
}
