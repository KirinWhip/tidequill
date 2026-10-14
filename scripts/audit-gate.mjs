// npm audit gate (Round 2 · D, item 25). Usage: npm audit --json > audit.json; node scripts/audit-gate.mjs audit.json
// Writes a Markdown summary of every finding (to stdout and $GITHUB_STEP_SUMMARY) and FAILS only when a high or
// critical advisory affects code that ships to users: the npm packages bundled into the app (build-meta/licenses.json,
// produced by `npm run build`) plus the Electron runtime itself. Build/test tooling findings (electron-builder, vite
// dev server, vitest, ...) are reported but do not fail the job; Dependabot opens PRs for them.
import fs from 'node:fs'
const audit = JSON.parse(fs.readFileSync(process.argv[2] || 'audit.json', 'utf8'))
let shipped = new Set(['electron'])
try { for (const p of JSON.parse(fs.readFileSync('build-meta/licenses.json', 'utf8'))) shipped.add(p.name) } catch { console.error('build-meta/licenses.json missing: run npm run build first'); process.exit(2) }
const rows = []; const blocking = []
for (const [name, v] of Object.entries(audit.vulnerabilities || {})) {
  const titles = v.via.filter(x => typeof x === 'object').map(x => `${x.title}${x.url ? ` (${x.url})` : ''}`)
  const via = v.via.filter(x => typeof x === 'string')
  const ships = shipped.has(name)
  const fix = typeof v.fixAvailable === 'object' ? `${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? ' (major)' : ''}` : String(v.fixAvailable)
  rows.push(`| ${v.severity} | \`${name}\` | ${ships ? 'yes' : 'no (build/test tooling)'} | ${[...titles, ...via.map(x => 'via ' + x)].join('<br>')} | ${fix} |`)
  if (ships && (v.severity === 'high' || v.severity === 'critical')) blocking.push(name)
}
const m = audit.metadata?.vulnerabilities || {}
const md = [`## npm audit`, '', `Totals: critical ${m.critical ?? 0}, high ${m.high ?? 0}, moderate ${m.moderate ?? 0}, low ${m.low ?? 0}`, '',
  `Blocking (high/critical in shipped code): ${blocking.length ? blocking.map(b => '`' + b + '`').join(', ') : 'none'}`, '',
  '| Severity | Package | Ships in app | Advisory | Fix |', '|---|---|---|---|---|', ...rows].join('\n')
console.log(md)
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n')
process.exit(blocking.length ? 1 : 0)
