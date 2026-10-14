import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { parseBackup, LEGACY_BACKUP_FORMAT, BACKUP_FORMAT } from '../src/shared/sync'

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

describe('rename & release metadata', () => {
  it('package metadata uses the new name, MIT license and author', () => {
    expect(pkg.name).toBe('tidequill'); expect(pkg.productName).toBe('Tidequill'); expect(pkg.version).toMatch(/^1\.0\.\d+$/)
    expect(pkg.license).toBe('MIT'); expect(pkg.author.name).toBe('追逐')
    expect(pkg.build.appId).toBe('io.github.kirinwhip.tidequill'); expect(pkg.build.win.icon).toBe('build/icon.ico')
    expect(pkg.build.publish[0].repo).toBe('tidequill')
  })
  it('no old product name left in shipped sources (except the two marked LEGACY_* compatibility constants)', () => {
    const files = execSync('git ls-files src electron index.html package.json public', { cwd: root, encoding: 'utf8' }).split('\n').filter(f => /\.(ts|tsx|html|json|css)$/.test(f))
    const bad = files.flatMap(f => fs.readFileSync(path.join(root, f), 'utf8').split('\n').filter(l => /chat\s*box/i.test(l) && !/LEGACY_[A-Z_]+ =/.test(l)).map(l => `${f}: ${l.trim()}`))
    expect(bad).toEqual([])
  })
  it('icon assets exist with the required sizes', () => {
    const ico = fs.readFileSync(path.join(root, 'build/icon.ico'))
    expect(ico.readUInt16LE(2)).toBe(1) // icon type
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(6) // image count
    for (const f of ['build/icon.png', 'build/icon.svg', 'build/tray.png', 'build/tray@2x.png', 'public/logo.png']) expect(fs.existsSync(path.join(root, f))).toBe(true)
  })
  it('LICENSE is MIT and license audit exists', () => {
    expect(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')).toMatch(/MIT License/)
    expect(fs.existsSync(path.join(root, 'docs/LICENSE-AUDIT.md'))).toBe(true)
  })
  it('backups from pre-1.0 versions are still accepted', () => {
    expect(LEGACY_BACKUP_FORMAT).not.toBe(BACKUP_FORMAT)
    expect(parseBackup(JSON.stringify({ format: LEGACY_BACKUP_FORMAT, version: 1, data: { conversations: [] } })).data.conversations).toEqual([])
  })
})
