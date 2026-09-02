import {readdir, readFile} from 'node:fs/promises'
import YAML from 'yaml'
let fmTotal = 0, bodyTotal = 0, missing = 0
const rows = []
for (const f of (await readdir('site/corpus/en')).filter(n => n.endsWith('.mdy'))) {
  const s = await readFile('site/corpus/en/' + f, 'utf8')
  const m = s.match(/^\+\+\+\n([\s\S]*?)\n\+\+\+\n([\s\S]*)$/)
  if (!m) continue
  const fm = YAML.parse(m[1]).images ?? []
  const body = m[2]
  const prefix = (src) => String(src).slice(0, String(src).lastIndexOf('/'))
  // One line: MDY elements have no closing `>`, so `[^>]*` crosses newlines.
  const inBody = new Set([...body.matchAll(/<img[^\n]*?src="([^"]+)"/g)].map(x => prefix(x[1])))
  const notShown = fm.filter(i => i.src && !inBody.has(prefix(i.src)))
  fmTotal += fm.length; bodyTotal += inBody.size; missing += notShown.length
  if (notShown.length) rows.push(`${notShown.length}/${fm.length} not in body — ${f.slice(0,-4)}`)
}
console.log(`front-matter images: ${fmTotal}   distinct images in bodies: ${bodyTotal}   in front matter but not body: ${missing}`)
for (const r of rows.slice(0, 8)) console.log('  ' + r)
