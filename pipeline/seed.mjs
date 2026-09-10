/**
 * Fill the queue: which cities the corpus does not have yet, in what order.
 *
 * Phase 0 answered "which articles" once, by hand, and threw the working out
 * away — `cities.json` was never committed, so "what is next" had to be
 * re-derived from the query service every time anybody asked. This keeps the
 * answer. `pipeline/queue.yaml` is the whole candidate list with the reason
 * beside every place that did not make it, and it is rewritten rather than
 * appended to: re-run this after Wikidata has moved and the queue moves with
 * it.
 *
 * What it does NOT keep is progress. Whether a city is imported or rewritten
 * is written on the disk already — `site/corpus/en/ur.mdy` is the fact that Ur
 * was imported — and a second copy of that in a YAML file is a copy that will
 * be wrong. `pipeline/queue.mjs` derives it. The only state here is editorial:
 * the `rejected` block, which is a person overruling the cuts, and which is
 * read back out of the existing queue and carried across untouched.
 *
 *   node pipeline/seed.mjs                     # ask Wikidata, write the queue
 *   node pipeline/seed.mjs --from cities.csv   # from a saved answer instead
 *   node pipeline/seed.mjs --dry               # print what would change
 *
 * The order is sitelink count, descending, which is a proxy for how much of
 * the world has already decided the place is worth writing about. It is not
 * the same as how much this corpus wants it — a city the corpus already links
 * to twelve times is worth more than a better-known one it never mentions —
 * so `queue.mjs` reports the link demand beside it and the two disagree
 * usefully.
 */

import {readdir, readFile, writeFile} from 'node:fs/promises'
import {defaultResolve} from 'mdy-docs/parse/wiki.js'
import YAML from 'yaml'
import {sort, year} from './cuts.mjs'

const QUERY = 'pipeline/select-cities.rq'
const QUEUE = 'pipeline/queue.yaml'
const CORPUS = 'site/corpus/en'
const CONTACT = 'gbelteshazzar@gmail.com'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const from = args[args.indexOf('--from') + 1]
const saved = args.includes('--from') ? from : undefined

/**
 * Parse CSV the way the query service writes it. Worth the twenty lines rather
 * than a split on commas: `Mari, Syria` and `Kish (Sumer)` are both titles and
 * only the first of them is quoted, so a naive split silently shifts every
 * column of that row one to the left and files Mari's sitelink count as its
 * coordinates.
 *
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
function csv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }

  if (field !== '' || row.length) { row.push(field); rows.push(row) }

  const head = rows.shift() ?? []

  return rows
    .filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])))
}

/** `Point(44.42415 32.522907)` — longitude first, which is not how it reads. */
const point = (where) => {
  const found = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(where ?? '')

  return found ? {lat: Number(found[2]), lon: Number(found[1])} : undefined
}

const answer = saved
  ? await readFile(saved, 'utf8')
  : await (async () => {
      const query = await readFile(QUERY, 'utf8')
      // POST, not a query string. The query is mostly comment — it argues for
      // every class in it — and once that argument outgrew the URL the service
      // answered 414 rather than anything about cities. A GET that works only
      // while nobody explains themselves is the wrong shape for this file.
      const res = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: {
          Accept: 'text/csv',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': `mdy-wikipedia-web corpus seeding (${CONTACT})`
        },
        body: new URLSearchParams({query})
      })

      if (!res.ok) throw new Error(`the query service said ${res.status} ${res.statusText}`)

      return res.text()
    })()

const rows = csv(answer)

if (!rows.length) throw new Error('the query returned no rows')

// The reject list is the one thing in the queue a person wrote, so it is the
// one thing a re-seed must not lose.
const before = YAML.parse(await readFile(QUEUE, 'utf8').catch(() => 'null')) ?? {}
const rejected = before.rejected ?? []
const overruled = new Map(rejected.map((r) => [r.title, r.why]))

const imported = new Set(
  (await readdir(CORPUS).catch(() => [])).filter((n) => n.endsWith('.mdy')).map((n) => n.slice(0, -4))
)

const candidates = []
const dropped = []
const unsorted = []
const kept = []

for (const row of rows) {
  const founded = year(row.from)
  const at = point(row.where)
  const place = {
    title: row.title,
    // The importer's own slugifier, not one that looks like it. `[[ label ]]`
    // resolves through this, so this is what decides whether a queued title
    // lands on the file the corpus already has.
    slug: defaultResolve(row.title),
    sitelinks: Number(row.sitelinks),
    ...(founded === undefined ? {} : {founded}),
    ...(at ? {at: [at.lat, at.lon]} : {})
  }

  // A place already in the corpus is never cut by rule. Somebody chose it, and
  // a heuristic does not get to overturn a decision a person already made —
  // Alexandria has five million people and twenty-one twin towns and is one of
  // the 49. What the cuts would have said about it is still worth knowing,
  // because it is the only measure of how often they are wrong, so it is
  // counted rather than acted on.
  const held = imported.has(place.slug)
  const verdict = overruled.has(row.title)
    ? {state: 'cut', why: `${overruled.get(row.title)} (by hand)`}
    : sort(row)

  if (verdict.state === 'candidate') candidates.push(place)
  else if (held) kept.push({...place, despite: verdict.why})
  else if (verdict.state === 'unsorted') unsorted.push({...place, why: verdict.why})
  else dropped.push({...place, why: verdict.why})
}

// Held against the cuts, so back in with the candidates — a place somebody
// already put in the corpus is a candidate whatever the rules think.
candidates.push(...kept.map(({despite, ...c}) => c))

candidates.sort((a, b) => b.sitelinks - a.sitelinks)
dropped.sort((a, b) => b.sitelinks - a.sitelinks)
unsorted.sort((a, b) => b.sitelinks - a.sitelinks)

const waiting = candidates.filter((c) => !imported.has(c.slug))

const queue = {
  about:
    'Every ancient city the query can find, with the reason beside the ones cut. ' +
    'Seeded by pipeline/seed.mjs from pipeline/select-cities.rq; the cuts are in ' +
    'pipeline/cuts.mjs. Progress is NOT recorded here — whether a city is imported ' +
    'or rewritten is derived from the disk by pipeline/queue.mjs. Edit `rejected` ' +
    'by hand to overrule a cut; a re-seed keeps it.',
  seeded: new Date().toISOString().slice(0, 10),
  counts: {
    returned: rows.length,
    candidates: candidates.length,
    cut: dropped.length,
    'in the corpus': candidates.length - waiting.length,
    waiting: waiting.length,
    unsorted: unsorted.length,
    'held against the cuts': kept.length
  },
  'held against the cuts': kept,
  rejected,
  candidates,
  unsorted,
  cut: dropped
}

// No aliases. A candidate held against the cuts appears twice, so its
// coordinate pair is one array in two places and YAML would helpfully write
// `&a1` and `*a1` — helpfully for a machine, and this file is read and edited
// by a person.
const text = YAML.stringify(queue, {lineWidth: 88, aliasDuplicateObjects: false})

console.log(
  `${rows.length} returned, ${candidates.length} candidates, ${dropped.length} cut, ` +
    `${unsorted.length} unsorted\n` +
    `${candidates.length - waiting.length} already in the corpus, ${waiting.length} waiting` +
    (kept.length ? `, ${kept.length} held against the cuts` : '')
)

console.log('\nnext, by sitelinks:')
for (const c of waiting.slice(0, 20)) {
  const when = c.founded === undefined ? '—' : c.founded < 0 ? `${-c.founded} BC` : `${c.founded} AD`
  console.log(`${String(c.sitelinks).padStart(6)}  ${when.padEnd(9)}  ${c.title}`)
}

console.log(`\ncut (${dropped.length}), first 8:`)
for (const d of dropped.slice(0, 8)) console.log(`  ${d.title} — ${d.why}`)

console.log(`\nunsorted (${unsorted.length}) — neither settlement nor monument, first 12:`)
for (const u of unsorted.slice(0, 12)) console.log(`  ${String(u.sitelinks).padStart(4)}  ${u.title}`)

if (kept.length) {
  console.log(`\nheld against the cuts (${kept.length}) — in the corpus, so kept anyway:`)
  for (const k of kept) console.log(`  ${k.title} — would have been ${k.despite}`)
}

if (dry) {
  console.log(`\n--dry: ${QUEUE} not written`)
} else {
  await writeFile(QUEUE, text)
  console.log(`\n→ ${QUEUE}`)
}
