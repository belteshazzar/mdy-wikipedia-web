/**
 * What a re-import would actually change.
 *
 * A rewrite is stale when the source it names has moved. Two things can move
 * it: Wikipedia editing the article, and this pipeline importing it
 * differently. Only the first shows up as a revision change, so both are
 * measured here — the revision, and the prose itself.
 */
import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {split} from './document.mjs'

const [a, b] = process.argv.slice(2)
const rows = []

for (const name of (await readdir(a)).filter((n) => n.endsWith('.mdy'))) {
  const before = split(await readFile(join(a, name), 'utf8'))
  const after = split(await readFile(join(b, name), 'utf8').catch(() => ''))

  if (!after.prose) continue

  const words = (t) => String(t).split(/\s+/).filter(Boolean)
  const w1 = words(before.prose)
  const w2 = words(after.prose)
  const same = new Set(w1)
  const added = w2.filter((w) => !same.has(w)).length
  const has = new Set(w2)
  const gone = w1.filter((w) => !has.has(w)).length

  rows.push({
    slug: name.slice(0, -4),
    revBefore: before.data.source?.revision,
    revAfter: after.data.source?.revision,
    revMoved: String(before.data.source?.revision) !== String(after.data.source?.revision),
    chars: after.prose.length - before.prose.length,
    added,
    gone
  })
}

const churned = rows.filter((r) => r.added + r.gone > 0)
const revMoved = rows.filter((r) => r.revMoved)

console.log(`${rows.length} articles compared\n`)
console.log(`  Wikipedia moved under us      ${revMoved.length}`)
console.log(`  prose differs after re-import ${churned.length}\n`)
console.log('article                          rev   chars   words +/-')

for (const r of churned.sort((x, y) => (y.added + y.gone) - (x.added + x.gone))) {
  console.log(
    `  ${r.slug.padEnd(30)} ${(r.revMoved ? 'MOVED' : '  =  ')} ${String(r.chars).padStart(6)}   +${r.added}/-${r.gone}`
  )
}

if (!churned.length) console.log('  (none)')
