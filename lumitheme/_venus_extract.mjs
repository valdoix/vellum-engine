// One-off: inspect a .lumitheme pack's theme.json to ground the Venus generator.
import { unzipSync, strFromU8 } from 'fflate'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, 'dist')

const arg = process.argv[2] || 'vellum-grimoire.lumitheme'
const buf = readFileSync(join(DIST, arg))
const files = unzipSync(new Uint8Array(buf))
const names = Object.keys(files)
console.log('=== files in pack ===')
console.log(names.join('\n'))

const tjName = names.find((n) => n.endsWith('theme.json'))
const tj = JSON.parse(strFromU8(files[tjName]))
console.log('\n=== theme.json top-level keys ===')
console.log(Object.keys(tj).join(', '))
console.log('\n=== manifest-ish fields ===')
for (const k of ['id', 'name', 'author', 'description', 'format', 'version']) {
  if (k in tj) console.log(`${k}:`, JSON.stringify(tj[k]))
}
console.log('\n=== theme (ThemeConfig) ===')
console.log(JSON.stringify(tj.theme, null, 2)?.slice(0, 1400))
console.log('\n=== components keys ===')
console.log(tj.components ? Object.keys(tj.components) : '(none)')
console.log('\n=== assets ===')
console.log((tj.assets || []).map((a) => a.archivePath || a.slug || a.originalFilename).join('\n') || '(none)')
console.log('\n=== globalCSS length ===', (tj.globalCSS || '').length)
console.log('\n=== globalCSS first 2500 chars ===')
console.log((tj.globalCSS || '').slice(0, 2500))
console.log('\n=== globalCSS: does it reference --lumiverse tokens? ===')
const g = tj.globalCSS || ''
for (const tok of ['--lumiverse-primary', '--lumiverse-bg', '--vm-body', '--vm-portraitA', 'data-component="MinimalMessage"', '@keyframes', 'assets/']) {
  const n = (g.match(new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  console.log(`  ${tok}: ${n}`)
}
