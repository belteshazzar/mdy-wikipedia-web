/**
 * The cities corpus in one region: which places are the entry point.
 *
 * The cuts themselves are in `pipeline/cuts.mjs`, which is where they belong
 * now that `seed.mjs` needs them too — a rule written down twice is a rule
 * that will disagree with itself. This is the regional report over them:
 * `cities.json` from the query, a bounding box, and what survives.
 *
 * A caller here gets fewer cuts than `seed.mjs` does, and correctly. The
 * monument-class, settlement-class, twin-town and head-of-government signals
 * are columns `select-cities.rq` grew later, and `cities.json` has not got
 * them, so `sort` reads what is there and stays quiet about the rest.
 *
 *   node pipeline/cities.mjs <cities.json> <south> <north> <west> <east> [--titles]
 */
import {readFile} from 'node:fs/promises'
import {sort, year} from './cuts.mjs'

const [file, south, north, west, east] = process.argv.slice(2)
const titlesOnly = process.argv.includes('--titles')

const all = JSON.parse(await readFile(file, 'utf8'))
const box = [Number(south), Number(north), Number(west), Number(east)]

const inside = all.filter(
  (c) => c.lat >= box[0] && c.lat <= box[1] && c.lon >= box[2] && c.lon <= box[3]
)

const kept = []
const cut = []

for (const c of inside.sort((a, b) => b.sitelinks - a.sitelinks)) {
  const {state, why} = sort(c)

  if (state === 'cut') { cut.push([c.title, why]); continue }

  kept.push(c)
}

if (titlesOnly) {
  console.log(kept.map((c) => c.title).join('\n'))
  process.exit(0)
}

console.log(`${inside.length} in the box, ${kept.length} kept, ${cut.length} cut\n`)
console.log('sitelinks  founded    city')

for (const c of kept.slice(0, 60)) {
  const f = year(c.from)
  console.log(
    `${String(c.sitelinks).padStart(9)}  ${(f === undefined ? '—' : f < 0 ? `${-f} BC` : `${f} AD`).padEnd(9)}  ${c.title}`
  )
}

console.log(`\ncut (${cut.length}), first 16:`)
for (const [title, why] of cut.slice(0, 16)) console.log(`  ${title} — ${why}`)
