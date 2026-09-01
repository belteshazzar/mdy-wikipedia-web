/**
 * Which tier each article belongs in.
 *
 * The plan ranks the corpus by how much of the world cares — sitelink count
 * across languages, and pageviews. The import already records the first of
 * those: `langlinks` maps every other wiki holding the same article to its
 * title there, so its key count is the sitelink count and the ranking needs no
 * second request.
 *
 * The split is the plan's, revised by what phase 2 measured: pillar articles
 * get every field and an anchored hook; body articles get the prose and none
 * of the five fields that fail seven times as often per word.
 *
 *   node pipeline/tiers.mjs           # the ranking
 *   node pipeline/tiers.mjs --body    # the body-tier slugs, for a run
 *   node pipeline/tiers.mjs --pillar  # the pillar-tier slugs
 */

import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import YAML from 'yaml'

const corpus = 'site/corpus/en'

// A slice this size has no long tail — 41 articles about the ancient Near East
// are all of them somebody's pillar. The cut is where the sitelink counts
// themselves fall away rather than at a round number.
const PILLAR = 60

const rows = []

for (const name of (await readdir(corpus)).filter((n) => n.endsWith('.mdy'))) {
  const source = await readFile(join(corpus, name), 'utf8')
  const data = YAML.parse(/^\+\+\+\n([\s\S]*?)\n\+\+\+/.exec(source)[1])
  const slug = name.slice(0, -4)

  rows.push({
    slug,
    title: data.title,
    languages: Object.keys(data.langlinks ?? {}).length,
    words: Math.round(source.length / 6)
  })
}

rows.sort((a, b) => b.languages - a.languages)

for (const row of rows) row.tier = row.languages >= PILLAR ? 'pillar' : 'body'

if (process.argv.includes('--body') || process.argv.includes('--pillar')) {
  const want = process.argv.includes('--body') ? 'body' : 'pillar'

  console.log(rows.filter((r) => r.tier === want).map((r) => r.slug).join(' '))
  process.exit(0)
}

console.log('rank  languages  tier    article')
rows.forEach((row, index) => {
  console.log(
    `${String(index + 1).padStart(4)}  ${String(row.languages).padStart(9)}  ` +
      `${row.tier.padEnd(7)} ${row.title}`
  )
})

const pillar = rows.filter((r) => r.tier === 'pillar').length

console.log(`\n  pillar  ${pillar}   (${PILLAR}+ languages: every field, anchored, then read)`)
console.log(`  body    ${rows.length - pillar}   (prose, key facts, image plan; no short fields)`)
