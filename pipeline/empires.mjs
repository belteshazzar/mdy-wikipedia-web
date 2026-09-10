/**
 * Which articles are states, and which states the cities are still asking for.
 *
 * The corpus was two rings — cities, and what a city needed explained. This is
 * the third: the empires that held them. `site/main.mdy` reads the `.yaml` this
 * writes exactly as it reads `cities.yaml`, because a state and a deity are
 * both just documents otherwise and only the entry document says which is
 * which.
 *
 * NOTHING HERE IS FETCHED
 *
 * The city-to-empire edge was already in the repository before this file
 * existed. Every imported article carries its Wikidata claims in its front
 * matter, and two of the twenty-four keys are the edge:
 *
 *   `capital-of` — the clean one, and the reason this works at all. Four of
 *   the sixty cities are Achaemenid capitals, four are Assyrian, three are
 *   Seleucid. It is a small, deliberate, well-curated property.
 *
 *   `country` — noisy, and dated, which makes it worth the noise. Babylon's is
 *   a succession with start and end years on every step: Babylonia, the
 *   Neo-Assyrian Empire, the Neo-Babylonian Empire, the Achaemenids, Macedon,
 *   the Seleucids, Parthia, the Sasanians, the Rashidun Caliphate. It also
 *   says Iraq, which is why it is read for demand and not for prose.
 *
 * So this asks no service anything. `pipeline/seed.mjs` has to, because a city
 * the corpus has never heard of cannot be in the corpus; a state is different,
 * because the cities that name it are already here.
 *
 * WHAT COUNTS AS A STATE
 *
 * `instance-of` includes `historical country`. Not a title regex and not a
 * list: every state document already in the corpus carries it — the Akkadian
 * Empire, Assyria, Macedon, the Middle and Neo-Assyrian Empires — and the
 * things that look like states and are not do not. `Empire` is an `instance-of
 * monarchy`, because it is the article about the idea. `Mesopotamia` is a
 * `historical region`. `Gutians` are a `people`. Each of those is a topic and
 * the ring already had them right.
 *
 * A CITY-STATE IS FILED AS A CITY
 *
 * Carchemish, Ebla, Lagash and Ugarit are all `historical country` and all
 * four are in `cities.yaml`. That is not a conflict to resolve, it is the
 * whole point of the place: the city was the state. Cities win, because the
 * corpus's editorial claim is that a reader arrives at a place — so the tie
 * is broken in `cities.yaml`'s favour and the four stay where they are.
 *
 *   node pipeline/empires.mjs           # write site/empires.yaml
 *   node pipeline/empires.mjs --wanted  # what the cities ask for and lack
 */

import {readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import YAML from 'yaml'
import {defaultResolve} from 'mdy-docs/parse/wiki.js'

const CORPUS = 'site/corpus/en'
const CITIES = 'site/cities.yaml'
const OUT = 'site/empires.yaml'

/** Wikidata's own name for a state that has ended. */
const STATE = 'historical country'

/**
 * A modern country, a governorate, a province, a district. `country` gives
 * these as readily as it gives the Achaemenids — Babylon's names Iraq — and
 * they are demand for nothing.
 */
const MODERN =
  /^(Iraq|Egypt|Syria|Turkey|Greece|Iran|Lebanon|Albania|Israel|Jordan|Ukraine|Sudan|Libya|Tunisia|Italy|Spain|Cyprus|Bahrain|Kuwait|Saudi Arabia|Yemen|Armenia|Azerbaijan|Georgia|Bulgaria|Romania|Russia|Palestine|.*Governorate|.*District|.*Province|.*State|.*Region)$/

const claims = (data) => data?.wikidata?.claims ?? {}
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])
const value = (v) => (typeof v === 'string' ? v : v?.value)
const slugOf = (title) => defaultResolve(title).replace(/^\/+/, '')

/** The front matter of one imported article. */
async function front(slug) {
  const raw = await readFile(join(CORPUS, `${slug}.mdy`), 'utf8').catch(() => undefined)
  const found = raw && /^\+\+\+\n([\s\S]*?)\n\+\+\+/.exec(raw)

  return found ? YAML.parse(found[1]) : undefined
}

const cities = new Set(YAML.parse(await readFile(CITIES, 'utf8')).cities ?? [])
const present = (await readdir(CORPUS))
  .filter((n) => n.endsWith('.mdy'))
  .map((n) => n.slice(0, -4))

const empires = []
const demand = new Map()

for (const slug of present) {
  const data = await front(slug)

  if (!data) continue

  const kinds = list(claims(data)['instance-of']).map(value).filter(Boolean)

  // A city-state is a city. The tie is broken in cities.yaml's favour.
  if (kinds.includes(STATE) && !cities.has(slug)) empires.push(slug)

  // Only a city gets to ask for a state. The ring asking would count the
  // Rosetta Stone's Ptolemies as demand from a document that is itself here
  // because a city needed it explained.
  if (!cities.has(slug)) continue

  for (const key of ['capital-of', 'country']) {
    for (const name of list(claims(data)[key]).map(value).filter(Boolean)) {
      if (MODERN.test(name)) continue

      if (!demand.has(name)) demand.set(name, {cities: new Set(), via: new Set()})

      demand.get(name).cities.add(slug)
      demand.get(name).via.add(key)
    }
  }
}

empires.sort()

const wanted = [...demand]
  .map(([title, d]) => ({
    title,
    slug: slugOf(title),
    cities: [...d.cities].sort(),
    via: [...d.via].sort().join(' + ')
  }))
  .filter((w) => !present.includes(w.slug))
  .sort((a, b) => b.cities.length - a.cities.length || a.title.localeCompare(b.title))

if (process.argv.includes('--wanted')) {
  console.log(`${wanted.length} states the cities name and the corpus has not got:\n`)

  for (const w of wanted) {
    console.log(
      `${String(w.cities.length).padStart(3)}  ${w.title.padEnd(30)}  ${w.via}\n` +
        `     ${w.cities.join(', ')}`
    )
  }
} else {
  await writeFile(
    OUT,
    YAML.stringify({
      about:
        'The states that held the cities. A document is one when its Wikidata ' +
        '`instance-of` includes `historical country` and `cities.yaml` has not ' +
        'already claimed it — a city-state is filed as a city. Generated by ' +
        'pipeline/empires.mjs from front matter that is already committed; ' +
        'nothing here is fetched.',
      count: empires.length,
      empires
    })
  )

  console.log(`${empires.length} states marked → ${OUT}`)
  console.log(`${wanted.length} more the cities ask for — \`--wanted\` to see them`)
}
