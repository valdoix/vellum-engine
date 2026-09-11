import { readFileSync } from 'node:fs'
const src = readFileSync('build.mjs', 'utf8')
const ids = [...src.matchAll(/id: '(vellum-[a-z]+)'/g)].map((m) => m[1])
for (const id of ids) {
  const i = src.indexOf(`id: '${id}'`)
  const chunk = src.slice(i, i + 1500)
  const accent = (chunk.match(/accent: hsl\(([^)]+)\)/) || [])[1]
  const rs = (chunk.match(/radiusScale: ([0-9.]+)/) || [])[1]
  const prim = (chunk.match(/primary: '(#[0-9a-fA-F]+)'/) || [])[1]
  const sec = (chunk.match(/secondary: '(#[0-9a-fA-F]+)'/) || [])[1]
  const bg = (chunk.match(/background: '(#[0-9a-fA-F]+)'/) || [])[1]
  const serif = (chunk.match(/--vm-serif:([^;]+);/) || [])[1]
  const body = (chunk.match(/--vm-body:([^;]+);/) || [])[1]
  console.log(id.padEnd(18), 'rs=' + rs, 'prim=' + prim, 'sec=' + sec, 'bg=' + bg)
  console.log('   serif=' + (serif || '').trim().slice(0, 46), '| body=' + (body || '').trim().slice(0, 34))
}
