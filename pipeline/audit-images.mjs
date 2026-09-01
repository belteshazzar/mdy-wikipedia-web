import {readFile} from 'node:fs/promises'
import YAML from 'yaml'
const m = YAML.parse(await readFile('site/corpus/images.yaml', 'utf8'))
const rows = Object.entries(m.images)
const noLicence = rows.filter(([, i]) => i.licence === 'unknown')
const noAuthor = rows.filter(([, i]) => i.author === 'unknown')
console.log('entries', rows.length)
console.log('  no licence', noLicence.length)
console.log('  no author ', noAuthor.length)
const lic = {}
for (const [, i] of rows) lic[i.licence] = (lic[i.licence] ?? 0) + 1
console.log('\nlicences:')
for (const [k, v] of Object.entries(lic).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log('\nno author, sample:')
for (const [f, i] of noAuthor.slice(0, 6)) console.log(`  ${i.licence.padEnd(16)} ${f.slice(0, 60)}`)
console.log('\nsizes offered:', JSON.stringify(rows.slice(0,1).map(([,i])=>Object.keys(i.sizes))[0]))
console.log('dropped:'); for (const d of m.dropped) console.log(`  ${d.reason}  —  ${d.file.slice(0,70)}`)
