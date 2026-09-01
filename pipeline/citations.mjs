/**
 * How many citations the rewriting pass loses, and where they went.
 *
 * "Citations ride along" is one of the rules that is not style, so it is worth
 * counting rather than trusting. Every `[[ ^n ]]` in an imported article's
 * prose should appear in the rewrite of it.
 *
 * The ones that do not are almost all the same case, reported unprompted by
 * eight separate rewrites: a footnote that sits on a FIGURE CAPTION rather
 * than on a sentence. A caption becomes an `image-plan` caption, and that
 * field is plain text with nowhere to put a reference — so the citation has no
 * home. This counts the damage that costs.
 */

import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {split} from './document.mjs'

const corpus = 'site/corpus/en'
const edited = 'site/edited/en'
const refs = (text) => new Set([...String(text).matchAll(/\[\[\s*\^([\w]+)\s*\]\]/g)].map((m) => m[1]))

let sourceTotal = 0
let lost = 0
const rows = []

for (const name of (await readdir(edited)).filter((n) => n.endsWith('.mdy'))) {
  const slug = name.slice(0, -4)
  const before = split(await readFile(join(corpus, `${slug}.mdy`), 'utf8'))
  const after = split(await readFile(join(edited, name), 'utf8'))
  const was = refs(before.prose)
  const is = refs(after.prose)
  const missing = [...was].filter((n) => !is.has(n))

  sourceTotal += was.size
  lost += missing.length

  if (missing.length) rows.push({slug, of: was.size, missing})
}

console.log(`${rows.length ? rows.length : 0} of ${(await readdir(edited)).filter((n) => n.endsWith('.mdy')).length} rewrites lose a citation\n`)

for (const row of rows.sort((a, b) => b.missing.length - a.missing.length)) {
  console.log(`  ${row.slug.padEnd(34)} ${String(row.missing.length).padStart(2)} of ${row.of}   ${row.missing.slice(0, 10).map((n) => '^' + n).join(' ')}`)
}

console.log(
  `\n  ${lost} lost of ${sourceTotal} distinct references — ` +
    `${((lost / sourceTotal) * 100).toFixed(1)}%`
)
