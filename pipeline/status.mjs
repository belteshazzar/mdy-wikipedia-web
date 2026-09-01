/**
 * What state the corpus is in, and what needs doing to it.
 *
 * Three questions, all of them answered by querying the documents rather than
 * by remembering:
 *
 *   Which rewrites are STALE — their source has been re-imported at a
 *   revision they were not made from. This is the whole reason a rewrite is a
 *   separate document naming the revision it came from.
 *
 *   Which are BLOCKED — the verifier found something a reader would be
 *   misled by, so they are not publishable.
 *
 *   Which are UNREVIEWED — no person has read them. Everything, so far.
 *
 *   node pipeline/status.mjs            # the summary
 *   node pipeline/status.mjs --stale    # just the stale slugs, for a re-run
 */

import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import YAML from 'yaml'

const corpus = 'site/corpus/en'
const edited = 'site/edited/en'
const only = process.argv.includes('--stale')

const matter = async (path) => {
  const source = await readFile(path, 'utf8')
  const found = /^\+\+\+\n([\s\S]*?)\n\+\+\+/.exec(source)

  return found ? YAML.parse(found[1]) : {}
}

const imported = (await readdir(corpus)).filter((n) => n.endsWith('.mdy')).map((n) => n.slice(0, -4))
const written = (await readdir(edited).catch(() => []))
  .filter((n) => n.endsWith('.mdy'))
  .map((n) => n.slice(0, -4))

const rows = []

for (const slug of written) {
  const rewrite = await matter(join(edited, `${slug}.mdy`))
  const source = await matter(join(corpus, `${slug}.mdy`)).catch(() => ({}))
  const was = rewrite.rewritten?.['source-revision']
  const is = source.source?.revision

  rows.push({
    slug,
    stale: Boolean(was && is && String(was) !== String(is)),
    was,
    is,
    verdict: rewrite.rewritten?.verdict ?? 'unverified',
    findings: rewrite.rewritten?.findings ?? 0,
    reviewed: rewrite.rewritten?.reviewed === true,
    anchored: Boolean(rewrite.anchors?.hook)
  })
}

const stale = rows.filter((r) => r.stale)

if (only) {
  console.log(stale.map((r) => r.slug).join(' '))
  process.exit(0)
}

const missing = imported.filter((slug) => !written.includes(slug))

console.log(`${imported.length} imported, ${written.length} rewritten, ${missing.length} not yet\n`)
console.log('slug                             verdict      findings  anchored  stale')

for (const r of rows.sort((a, b) => a.slug.localeCompare(b.slug))) {
  console.log(
    `  ${r.slug.padEnd(30)} ${r.verdict.padEnd(12)} ${String(r.findings).padStart(5)}     ` +
      `${(r.anchored ? 'yes' : 'no').padEnd(9)}${r.stale ? 'STALE' : ''}`
  )
}

const count = (test) => rows.filter(test).length

console.log(`\n  blocked          ${count((r) => r.verdict === 'blocked')}`)
console.log(`  minor only       ${count((r) => r.verdict === 'minor-only')}`)
console.log(`  clean            ${count((r) => r.verdict === 'clean')}`)
console.log(`  unverified       ${count((r) => r.verdict === 'unverified')}`)
console.log(`  anchored fields  ${count((r) => r.anchored)}`)
console.log(`  read by a person ${count((r) => r.reviewed)}`)

if (stale.length) {
  console.log(`\nSTALE — the source moved under them:`)
  for (const r of stale) console.log(`  ${r.slug}: rewritten from ${r.was}, corpus now ${r.is}`)
  console.log(`\n  node pipeline/rewrite.mjs --emit $(node pipeline/status.mjs --stale)`)
}

if (missing.length) {
  console.log(`\nnot yet rewritten (${missing.length}):`)
  console.log('  ' + missing.join(' '))
}
