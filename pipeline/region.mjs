/**
 * Draw the region locally.
 *
 * The corpus boundary is an editorial decision and it changes; asking the
 * query service again every time you move it is the wrong shape. So the query
 * returns every ancient city it can find with coordinates, and this cuts the
 * box.
 *
 *   node pipeline/region.mjs cities.json 29 38 38 49   # south north west east
 *   node pipeline/region.mjs cities.json 29 38 38 49 --titles
 */
import {readFile} from 'node:fs/promises'

const [file, south, north, west, east] = process.argv.slice(2)
const box = [Number(south), Number(north), Number(west), Number(east)]
const titlesOnly = process.argv.includes('--titles')
const all = JSON.parse(await readFile(file, 'utf8'))

const inside = all.filter(
  (c) => c.lat >= box[0] && c.lat <= box[1] && c.lon >= box[2] && c.lon <= box[3]
)

inside.sort((a, b) => b.sitelinks - a.sitelinks)

if (titlesOnly) {
  console.log(inside.map((c) => c.title).join('\n'))
  process.exit(0)
}

console.log(`${all.length} ancient cities with coordinates worldwide`)
console.log(`${inside.length} inside ${box[0]}–${box[1]}N, ${box[2]}–${box[3]}E\n`)
console.log('sitelinks  from            city')

for (const c of inside) {
  console.log(
    `${String(c.sitelinks).padStart(9)}  ${String(c.from).slice(0, 11).padEnd(14)}  ${c.title}`
  )
}
