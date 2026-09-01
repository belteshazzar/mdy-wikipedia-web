/** What the corpus can be asked, before deciding what to ask it. */
import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import YAML from 'yaml'

const dir = 'site/edited/en'
let coords = 0, timelines = 0, events = 0, held = 0, heldRows = 0, inception = 0, glossary = 0, quotes = 0
const kinds = {}

for (const name of (await readdir(dir)).filter((n) => n.endsWith('.mdy'))) {
  const d = YAML.parse((await readFile(join(dir, name), 'utf8')).match(/^\+\+\+\n([\s\S]*?)\n\+\+\+/)[1])

  if (d.coordinates?.lat !== undefined) coords += 1
  if (d.timeline?.length) { timelines += 1; events += d.timeline.length }
  if (d.glossary?.length) glossary += d.glossary.length
  if (d['pull-quotes']?.length) quotes += d['pull-quotes'].length

  const claims = d.wikidata?.claims ?? {}
  const country = Array.isArray(claims.country) ? claims.country : claims.country ? [claims.country] : []
  const dated = country.filter((c) => typeof c === 'object' && (c.from || c.to))

  if (dated.length) { held += 1; heldRows += dated.length }
  if (claims.inception) inception += 1

  const io = claims['instance-of']
  const first = Array.isArray(io) ? io[0] : io
  const kind = typeof first === 'object' ? first?.value : first

  if (kind) kinds[kind] = (kinds[kind] ?? 0) + 1
}

console.log(`41 articles:`)
console.log(`  with coordinates          ${coords}`)
console.log(`  with a timeline           ${timelines}  (${events} dated events)`)
console.log(`  with dated 'country'      ${held}  (${heldRows} rows of who held what)`)
console.log(`  with an inception date    ${inception}`)
console.log(`  glossary terms            ${glossary}`)
console.log(`  pull quotes               ${quotes}`)
console.log(`\ninstance-of, most common:`)
for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(n).padStart(3)}  ${k}`)
}
