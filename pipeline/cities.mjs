/**
 * The cities corpus: which places are the entry point.
 *
 * Wikidata's `archaeological site` covers a settlement and a single monument
 * equally, so the class alone gives Ur and the Great Sphinx the same standing.
 * A corpus of cities wants the first and not the second, and no property
 * separates them — so the separation is editorial and written down here rather
 * than pretended into the query.
 *
 * Two cuts, both stated:
 *
 *   - MONUMENTS. A pyramid, a temple, an arch, a wall or a tomb is a thing IN
 *     a city, not a city. They belong in the ring if anywhere.
 *   - LIVING CITIES founded after antiquity. Cairo (969) and Samarra (836) are
 *     ancient-adjacent, and their articles are about the modern city — 42
 *     sections of climate normals and football clubs, as Alexandria's was.
 *
 *   node pipeline/cities.mjs <cities.json> <south> <north> <west> <east> [--titles]
 */
import {readFile} from 'node:fs/promises'

const [file, south, north, west, east] = process.argv.slice(2)
const titlesOnly = process.argv.includes('--titles')

/** A thing inside a city rather than a city. */
const monument =
  /\b(pyramid|pyramids|sphinx|temple|tomb|tombs|wall|arch|mosque|church|cathedral|obelisk|statue|colossi|gate|necropolis|monastery|ziggurat|valley of the kings|valley of the queens|catacombs?|aqueduct|theatre|amphitheatre)\b/i

/** Founded too late to be an ancient city, whatever else it is. */
const LATEST = 500

const all = JSON.parse(await readFile(file, 'utf8'))
const box = [Number(south), Number(north), Number(west), Number(east)]

const year = (from) => {
  if (!from) return undefined
  const bc = String(from).startsWith('-')
  const n = Number(String(from).replace(/^-/, '').slice(0, 4))
  return Number.isNaN(n) ? undefined : bc ? -n : n
}

const inside = all.filter(
  (c) => c.lat >= box[0] && c.lat <= box[1] && c.lon >= box[2] && c.lon <= box[3]
)

const kept = []
const cut = []

for (const c of inside.sort((a, b) => b.sitelinks - a.sitelinks)) {
  const founded = year(c.from)

  if (monument.test(c.title)) { cut.push([c.title, 'monument']); continue }
  if (founded !== undefined && founded > LATEST) { cut.push([c.title, `founded ${founded}`]); continue }

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
