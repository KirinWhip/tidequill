import { describe, it, expect } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { JsonStore, atomicWrite, validShape } from '../electron/store'

const mk = (count = 5, interval = 0) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'))
  const data = path.join(root, 'data'); fs.mkdirSync(data)
  return { root, data, st: new JsonStore(data, path.join(root, 'backups'), count, interval) }
}

describe('JsonStore (atomic writes, rotating backups, corruption recovery)', () => {
  it('atomic write leaves no temp file and replaces content', () => {
    const { data } = mk(); const f = path.join(data, 'x.json')
    atomicWrite(f, '1'); atomicWrite(f, '2')
    expect(fs.readFileSync(f, 'utf8')).toBe('2'); expect(fs.existsSync(f + '.tmp')).toBe(false)
  })
  it('keeps the newest N backups and skips unchanged content', () => {
    const { st } = mk(3, 0)
    for (let i = 0; i < 6; i++) st.write('conversations', [{ id: String(i) }], 1_700_000_000_000 + i * 1000)
    st.write('conversations', [{ id: '5' }], 1_700_000_100_000) // unchanged -> no new backup
    const b = st.backupsOf('conversations')
    expect(b).toHaveLength(3)
    expect(JSON.parse(fs.readFileSync(b[0], 'utf8'))).toEqual([{ id: '5' }])
  })
  it('backup interval limits how often a key is backed up', () => {
    const { st } = mk(5, 600_000)
    st.write('folders', [1], 1_000_000); st.write('folders', [2], 1_100_000); st.write('folders', [3], 1_700_000)
    expect(st.backupsOf('folders')).toHaveLength(2)
  })
  it('corrupt JSON is moved aside and the newest valid backup restored, with a notice', () => {
    const { data, st } = mk(5, 0)
    st.write('conversations', [{ id: 'a' }], 1_000); st.write('conversations', [{ id: 'b' }], 2_000)
    fs.writeFileSync(path.join(data, 'conversations.json'), '[{"id": "b"') // truncated write
    // newest backup is also damaged -> falls back to the older one
    fs.writeFileSync(st.backupsOf('conversations')[0], '{oops')
    expect(st.read('conversations', 3_000)).toEqual([{ id: 'a' }])
    expect(JSON.parse(fs.readFileSync(path.join(data, 'conversations.json'), 'utf8'))).toEqual([{ id: 'a' }])
    expect(st.notices).toHaveLength(1)
    expect(st.notices[0]).toMatchObject({ key: 'conversations', kind: 'restored' })
    expect(fs.readFileSync(path.join(data, st.notices[0].corruptFile), 'utf8')).toBe('[{"id": "b"')
  })
  it('wrong top-level type counts as corruption; no backup -> reset notice', () => {
    const { data, st } = mk()
    fs.writeFileSync(path.join(data, 'settings.json'), '[]')
    expect(st.read('settings')).toBeUndefined()
    expect(st.notices[0]).toMatchObject({ key: 'settings', kind: 'reset' })
    expect(fs.existsSync(path.join(data, 'settings.json'))).toBe(false)
    expect(validShape('conversations', {})).toBe(false); expect(validShape('tombstones', {})).toBe(true)
  })
  it('missing file is not corruption', () => {
    const { st } = mk(); expect(st.read('prompts')).toBeUndefined(); expect(st.notices).toEqual([])
  })
})
