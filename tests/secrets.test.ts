import { describe, it, expect } from 'vitest'
import { encryptSettings, decryptSettings, ENC_PREFIX, type Cipher } from '../electron/secrets'

const rot: Cipher = { available: () => true, encrypt: s => Buffer.from(s).reverse().toString('base64'), decrypt: s => Buffer.from(s, 'base64').reverse().toString() }
const s = { language: 'zh', providers: [{ id: 'a', apiKey: 'sk-secret' }, { id: 'b', apiKey: '' }] }

describe('API key encryption', () => {
  it('encrypts keys and never stores plaintext', () => {
    const e = encryptSettings(s, rot)
    expect(e.providers[0].apiKey.startsWith(ENC_PREFIX)).toBe(true)
    expect(JSON.stringify(e)).not.toContain('sk-secret')
    expect(e.providers[1].apiKey).toBe('')
  })
  it('round-trips', () => {
    const d = decryptSettings(encryptSettings(s, rot), rot)
    expect(d.settings.providers[0].apiKey).toBe('sk-secret'); expect(d.needsMigration).toBe(false)
  })
  it('flags plaintext keys for migration', () => {
    const d = decryptSettings(s, rot)
    expect(d.needsMigration).toBe(true); expect(d.settings.providers[0].apiKey).toBe('sk-secret')
  })
  it('does not double-encrypt', () => {
    const once = encryptSettings(s, rot)
    expect(encryptSettings(once, rot).providers[0].apiKey).toBe(once.providers[0].apiKey)
  })
  it('leaves data untouched when encryption unavailable', () => {
    const no: Cipher = { ...rot, available: () => false }
    expect(encryptSettings(s, no)).toBe(s); expect(decryptSettings(s, no).needsMigration).toBe(false)
  })
})
