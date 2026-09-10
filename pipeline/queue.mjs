/**
 * What the queue is up to, and what to import next.
 *
 * `seed.mjs` writes the candidate list; this reads it against the disk. No
 * progress is stored anywhere — `site/corpus/en/ur.mdy` is the fact that Ur
 * was imported and `site/edited/en/ur.mdy` the fact that it was rewritten, so
 * the state of a candidate is a query over two directories rather than a field
 * somebody has to remember to update. Same reasoning as `status.mjs`, for the
 * same reason: a second copy of a fact is a copy that will be wrong.
 *
 *   node pipeline/queue.mjs              # what state the queue is in
 *   node pipeline/queue.mjs next 10      # the next ten titles, for --from
 *   node pipeline/queue.mjs next 10 --wanted   # ranked by what the corpus asks for
 *   node pipeline/queue.mjs pending      # imported, not rewritten — slugs
 *   node pipeline/queue.mjs unsorted     # the ones a person has to sort
 *
 * `next` prints bare titles and nothing else, so it pipes straight into the
 * importer; `pending` prints bare slugs, which is what the rewriting pass
 * takes. Titles going in and slugs coming out is not an inconsistency — the
 * importer is given a Wikipedia title and everything downstream of it is
 * addressed by the file it wrote.
 *
 *   node pipeline/queue.mjs next 10 --wanted > pipeline/next.txt
 *   node third-party/mdy-wikipedia/bin/mdy-wikipedia.js \
 *     --from pipeline/next.txt --out-dir site/corpus/en --links wiki \
 *     --categories --lang-links --delay 100 --contact you@example.com
 *   node pipeline/rewrite.mjs --emit --body $(node pipeline/queue.mjs pending)
 *
 * TWO ORDERS, AND THEY DISAGREE
 *
 * By default `next` is sitelink order: how much of the world has already
 * decided the place is worth writing about. `--wanted` is the other question —
 * how many documents in this corpus already link to it and cannot resolve it.
 * Phase 0 found that the second is what makes a corpus feel whole, because it
 * is the measure of a hole rather than of fame. They disagree usefully, and
 * neither is right on its own: Constantinople is the most linked-about city in
 * the world and nothing here asks for it, while a city eleven documents want
 * may have twenty sitelinks.
 */

import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import YAML from 'yaml'

const QUEUE = 'pipeline/queue.yaml'
const CORPUS = 'site/corpus/en'
const EDITED = 'site/edited/en'

const args = process.argv.slice(2)
const command = args.find((a) => !a.startsWith('--') && Number.isNaN(Number(a))) ?? 'status'
const count = Number(args.find((a) => !Number.isNaN(Number(a)) && a !== '')) || 10
const byWant = args.includes('--wanted')

const queue = YAML.parse(await readFile(QUEUE, 'utf8').catch(() => 'null'))

if (!queue) {
  console.error(`no ${QUEUE} — run \`node pipeline/seed.mjs\` first`)
  process.exit(1)
}

const slugs = async (dir) =>
  new Set(
    (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.mdy')).map((n) => n.slice(0, -4))
  )

const imported = await slugs(CORPUS)
const rewritten = await slugs(EDITED)

/**
 * How many documents in the corpus link to a slug they cannot resolve. The
 * same count `check-links.mjs` reports, gathered here rather than imported
 * from it because that script is a report and this is a sort key.
 *
 * @returns {Promise<Map<string, number>>}
 */
async function demand() {
  const wanted = new Map()

  for (const name of await readdir(CORPUS).catch(() => [])) {
    if (!name.endsWith('.mdy')) continue

    const text = await readFile(join(CORPUS, name), 'utf8')
    const seen = new Set()

    for (const [, target] of text.matchAll(/\[\[\s*(?:[^|\]]*\|)?\s*([^\]]+?)\s*\]\]/g)) {
      const slug = target.trim()

      // `^12` is a footnote reference, not a link to a document called 12.
      if (!slug || slug.startsWith('^') || imported.has(slug)) continue

      seen.add(slug)
    }

    for (const slug of seen) wanted.set(slug, (wanted.get(slug) ?? 0) + 1)
  }

  return wanted
}

const state = (slug) =>
  rewritten.has(slug) ? 'rewritten' : imported.has(slug) ? 'imported' : 'waiting'

const candidates = queue.candidates ?? []
const waiting = candidates.filter((c) => state(c.slug) === 'waiting')

if (command === 'unsorted') {
  const unsorted = queue.unsorted ?? []

  console.log(
    `${unsorted.length} places Wikidata calls neither a settlement nor a monument.\n` +
      `Each is a city to queue or a thing to reject; nothing else can tell them apart.\n` +
      `Move one into the corpus by adding its title to an import, or into\n` +
      `${QUEUE}'s \`rejected\` block, which a re-seed keeps.\n`
  )

  for (const u of unsorted) {
    const when = u.founded === undefined ? '—' : u.founded < 0 ? `${-u.founded} BC` : `${u.founded} AD`
    console.log(`${String(u.sitelinks).padStart(5)}  ${when.padEnd(9)}  ${u.title}`)
  }

  process.exit(0)
}

if (command === 'pending') {
  // Every slug in the corpus with no rewrite beside it — not just the queue's
  // own, because a ring article imported by hand needs rewriting exactly as
  // much and `rewrite.mjs` does not care where a slug came from. This is the
  // step after an import: `next` names what to fetch, `pending` names what to
  // write.
  for (const slug of [...imported].filter((s) => !rewritten.has(s)).sort()) console.log(slug)
  process.exit(0)
}

if (command === 'next') {
  let take = waiting

  if (byWant) {
    const wanted = await demand()

    take = [...waiting].sort(
      (a, b) => (wanted.get(b.slug) ?? 0) - (wanted.get(a.slug) ?? 0) || b.sitelinks - a.sitelinks
    )
  }

  for (const c of take.slice(0, count)) console.log(c.title)
  process.exit(0)
}

const counts = {rewritten: 0, imported: 0, waiting: 0}

for (const c of candidates) counts[state(c.slug)]++

const wanted = await demand()
const pull = [...waiting].sort(
  (a, b) => (wanted.get(b.slug) ?? 0) - (wanted.get(a.slug) ?? 0) || b.sitelinks - a.sitelinks
)

console.log(
  `${QUEUE}, seeded ${queue.seeded}\n\n` +
    `${candidates.length} candidates — ${counts.rewritten} rewritten, ` +
    `${counts.imported} imported and not rewritten, ${counts.waiting} waiting\n` +
    `${(queue.unsorted ?? []).length} unsorted, ${(queue.cut ?? []).length} cut, ` +
    `${(queue.rejected ?? []).length} rejected by hand`
)

console.log('\nnext by sitelinks:')
for (const c of waiting.slice(0, 12)) {
  console.log(`${String(c.sitelinks).padStart(5)}  ${c.title}`)
}

console.log('\nnext by what the corpus already asks for:')
for (const c of pull.slice(0, 12)) {
  const asks = wanted.get(c.slug) ?? 0

  console.log(`${String(asks).padStart(5)} ${asks === 1 ? 'doc ' : 'docs'}  ${c.title}`)
}
