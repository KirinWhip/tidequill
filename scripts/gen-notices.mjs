// Generates THIRD_PARTY_NOTICES.txt from the npm packages that are actually bundled into the shipped app
// (renderer modules recorded by the vite plugin + main/preload inputs from the esbuild metafile).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const meta = f => { try { return JSON.parse(fs.readFileSync(path.join(root, 'build-meta', f), 'utf8')) } catch { return null } }
const renderer = meta('renderer-modules.json') || []
const main = meta('main-meta.json')
const ids = [...renderer, ...(main ? Object.keys(main.inputs) : [])]
if (!renderer.length || !main) { console.error('gen-notices: build-meta missing, run vite build and build:main first'); process.exit(1) }

/** map a module path to its package root (handles scoped + nested node_modules) */
function pkgRoot(id) {
  const p = id.replace(/\\/g, '/').replace(/^\0/, '').split('?')[0]
  const i = p.lastIndexOf('node_modules/')
  if (i < 0) return null
  const rest = p.slice(i + 13).split('/')
  const name = rest[0].startsWith('@') ? rest[0] + '/' + rest[1] : rest[0]
  const abs = path.isAbsolute(p) ? p : path.join(root, p)
  return abs.slice(0, abs.lastIndexOf('node_modules/') + 13) + name
}
const roots = new Set(ids.map(pkgRoot).filter(Boolean))
const pkgs = new Map()
for (const r of roots) {
  let pj; try { pj = JSON.parse(fs.readFileSync(path.join(r, 'package.json'), 'utf8')) } catch { continue }
  const license = typeof pj.license === 'string' ? pj.license : pj.license?.type || (pj.licenses || []).map(l => l.type || l).join(' OR ') || 'UNKNOWN'
  const lf = fs.readdirSync(r).find(f => /^(licen[cs]e|copying)(\.|$|-mit)/i.test(f))
  const text = lf ? fs.readFileSync(path.join(r, lf), 'utf8').trim() : ''
  let lic = license
  if (lic === 'UNKNOWN' && /^the mit license|^mit license/i.test(text)) lic = 'MIT'
  const key = `${pj.name}@${pj.version}`
  if (!pkgs.has(key)) pkgs.set(key, { name: pj.name, version: pj.version, license: lic, repo: typeof pj.repository === 'string' ? pj.repository : pj.repository?.url || pj.homepage || '', text })
}
const MIT = 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.'
const list = [...pkgs.values()].sort((a, b) => a.name.localeCompare(b.name))
const summary = {}
for (const p of list) summary[p.license] = (summary[p.license] || 0) + 1
const out = [
  'Tidequill — THIRD-PARTY SOFTWARE NOTICES',
  '',
  'Tidequill is MIT-licensed (see LICENSE). It bundles the open-source packages listed below; each remains under its own license.',
  'The Electron runtime (MIT) and Chromium are shipped as well; their licenses are in LICENSE.electron.txt and LICENSES.chromium.html next to the executable.',
  '',
  `Packages: ${list.length}. Licenses: ${Object.entries(summary).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ')}`,
  '',
  ...list.map(p => `- ${p.name}@${p.version}  ${p.license}  ${p.repo}`),
  '',
  '='.repeat(78),
  ...list.flatMap(p => ['', `${p.name}@${p.version} — ${p.license}`, '-'.repeat(78), p.text || (p.license === 'MIT' ? `(package ships no license file; package.json declares MIT. Standard MIT terms apply:)\n${MIT}` : `(no license file in package; license field: ${p.license})`)]),
  '',
].join('\n')
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), out)
fs.writeFileSync(path.join(root, 'build-meta', 'licenses.json'), JSON.stringify(list.map(({ text, ...x }) => x), null, 2))
console.log(`THIRD_PARTY_NOTICES.txt: ${list.length} packages`, summary)
