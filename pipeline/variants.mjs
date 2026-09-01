/**
 * How much of the link graph is the same subject under two names.
 *
 * Wikipedia reaches one article by many titles: `Set (deity)` and
 * `Set (mythology)` are a page and a redirect to it, and an article may use
 * either. `--links wiki` slugifies the title as written, so the vault gets two
 * slugs for one subject — three separate rewrites reported hitting this
 * without being asked about it.
 *
 * This lists CANDIDATES and does not count defects, because the two cases look
 * identical from here. `Set (deity)` and `Set (mythology)` are one subject
 * under two names; `Macedonia (ancient kingdom)` and `Macedonia (Roman
 * province)` are two subjects that share one. Telling them apart means asking
 * the API which titles are redirects — a step the importer does not have, and
 * the real fix, since it would also have merged `Akkadian Period` into
 * `Akkadian Empire` back in phase 0.
 *
 * So: read the list, do not total it.
 */

import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import YAML from 'yaml'

const corpus = 'site/corpus/en'
/** @type {Map<string, Set<string>>} base subject → the slugs reaching it */
const groups = new Map()

for (const name of (await readdir(corpus)).filter((n) => n.endsWith('.mdy'))) {
  const source = await readFile(join(corpus, name), 'utf8')
  const data = YAML.parse(/^\+\+\+\n([\s\S]*?)\n\+\+\+/.exec(source)[1])

  for (const [slug, title] of Object.entries(data['link-titles'] ?? {})) {
    // Group on the TITLE, not the slug. `Set (deity)` and `Set (mythology)`
    // share everything before the bracket; `Romanization of Ancient Greek` and
    // `Romanization of Ancient Egyptian` share only a prefix, and grouping on
    // slugs mistook the second pair for the first.
    const match = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(String(title))

    if (!match) continue

    const entry = groups.get(match[1]) ?? new Set()

    entry.add(slug)
    groups.set(match[1], entry)
  }
}

const split = [...groups].filter(([, slugs]) => slugs.size > 1).sort((a, b) => b[1].size - a[1].size)
const extra = split.reduce((n, [, slugs]) => n + slugs.size - 1, 0)

console.log(`${groups.size} titles carry a disambiguator`)
console.log(
  `${split.length} base names are reached by more than one slug (${extra} beyond the first).\n` +
    'Some are one subject under two names, some are two subjects sharing one\n' +
    'name, and only the API can say which is which:\n'
)

for (const [base, slugs] of split.slice(0, 12)) {
  console.log(`  ${base.padEnd(22)} ${[...slugs].join('  ')}`)
}
