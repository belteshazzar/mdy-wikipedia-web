/**
 * Where the verifier's findings actually are.
 *
 * The question phase 2 exists to answer is not "is the rewrite good" but
 * "where does it go wrong", and the answer turns out to depend on which FIELD
 * a sentence lives in rather than on which article it belongs to. So this
 * locates every finding: in the rewritten prose (the lead and the section
 * bodies), or in one of the short fields the layout is built from.
 */

import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import YAML from 'yaml'
import {split} from './document.mjs'

const edited = 'site/edited/en'
const short = ['hook', 'standfirst', 'key-facts', 'pull-quotes', 'timeline', 'glossary', 'further']

/** A loose containment test: the verifier quotes, it does not cite offsets. */
const has = (haystack, needle) => {
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim()
  const n = norm(needle)

  return norm(haystack).includes(n.length > 60 ? n.slice(0, 60) : n)
}

const tally = {prose: 0, fields: 0, unplaced: 0}
const blocking = {prose: 0, fields: 0, unplaced: 0}
const byKind = {}
const rows = []

for (const name of (await readdir(edited)).filter((n) => n.endsWith('.verify.yaml'))) {
  const report = YAML.parse(await readFile(join(edited, name), 'utf8'))
  const slug = name.slice(0, -'.verify.yaml'.length)
  const doc = split(await readFile(join(edited, `${slug}.mdy`), 'utf8'))
  const fieldText = YAML.stringify(
    Object.fromEntries(short.filter((k) => doc.data[k] !== undefined).map((k) => [k, doc.data[k]]))
  )

  let p = 0
  let f = 0

  for (const finding of report.findings ?? []) {
    const inProse = has(doc.prose, finding.quote)
    const inFields = has(fieldText, finding.quote)
    const where = inProse && !inFields ? 'prose' : inFields ? 'fields' : 'unplaced'

    tally[where] += 1
    if (finding.severity === 'blocking') blocking[where] += 1
    byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1
    if (where === 'prose') p += 1
    else if (where === 'fields') f += 1
  }

  rows.push({slug, verdict: report.verdict, n: (report.findings ?? []).length, p, f})
}

const total = tally.prose + tally.fields + tally.unplaced

console.log(`${rows.length} articles verified, ${total} findings\n`)
console.log('article                          verdict      findings  prose  fields')
for (const r of rows.sort((a, b) => b.n - a.n)) {
  console.log(
    `  ${r.slug.padEnd(30)} ${r.verdict.padEnd(12)} ${String(r.n).padStart(5)}  ${String(r.p).padStart(5)}  ${String(r.f).padStart(6)}`
  )
}

console.log(`\nwhere the findings are`)
console.log(`  in the rewritten prose (lead + sections)  ${tally.prose}  (${blocking.prose} blocking)`)
console.log(`  in the short generated fields            ${tally.fields}  (${blocking.fields} blocking)`)
if (tally.unplaced) console.log(`  not located                             ${tally.unplaced}  (${blocking.unplaced} blocking)`)

console.log(`\nby kind`)
for (const [kind, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${kind}`)
}

const words = (s) => String(s).split(/\s+/).filter(Boolean).length
let proseWords = 0
let fieldWords = 0

for (const name of (await readdir(edited)).filter((n) => n.endsWith('.mdy'))) {
  const doc = split(await readFile(join(edited, name), 'utf8'))
  proseWords += words(doc.prose)
  for (const key of short) fieldWords += words(JSON.stringify(doc.data[key] ?? ''))
}

console.log(`\nfor scale`)
console.log(`  rewritten prose   ${proseWords.toLocaleString()} words`)
console.log(`  short fields      ${fieldWords.toLocaleString()} words`)
console.log(
  `  findings per 1,000 words — prose ${((tally.prose / proseWords) * 1000).toFixed(2)}, ` +
    `fields ${((tally.fields / fieldWords) * 1000).toFixed(2)}`
)
