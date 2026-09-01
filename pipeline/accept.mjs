/**
 * Accept a source change without re-running the rewrite.
 *
 * Staleness is not always worth acting on. When a re-import changes prose the
 * rewrite never touched — restored pronunciation symbols in an etymology the
 * article summarised in one clause — regenerating is a bad trade: it discards
 * a verified rewrite, produces different prose, and needs verifying again, all
 * to gain something nobody would notice.
 *
 * So this is the other move. It re-fingerprints the rewrite against the corpus
 * as it is now and records, in the document, that a person decided the change
 * did not matter and why. The alternative — leaving twelve documents
 * permanently stale — trains everyone to ignore the stale list, which is the
 * one thing it must not be.
 *
 * It does NOT re-verify. The claim being made is that the rewrite is still
 * faithful to the new source, which holds when the change is additive.
 *
 * One limitation worth knowing: `compose` rebuilds a document from scratch, so
 * re-applying an answer afterwards wipes the note. Accept last, or record the
 * decision somewhere a re-apply cannot reach.
 *
 *   node pipeline/accept.mjs --why "restored IPA the rewrite never used" slug...
 */

import {readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import YAML from 'yaml'
import {digest, split} from './document.mjs'

const args = process.argv.slice(2)
const at = args.indexOf('--why')
const why = at === -1 ? undefined : args[at + 1]
const slugs = args.filter((a, i) => !a.startsWith('--') && i !== at + 1)

if (!why) {
  console.error('a reason is required: --why "…"')
  process.exit(1)
}

for (const slug of slugs) {
  const path = join('site/edited/en', `${slug}.mdy`)
  const raw = await readFile(path, 'utf8')
  const source = split(await readFile(join('site/corpus/en', `${slug}.mdy`), 'utf8'))
  const revision = source.data.source?.revision

  let updated = raw.replace(/^(\s*)source-digest: .*$/m, `$1source-digest: ${digest(source.prose)}`)

  if (revision) {
    updated = updated.replace(/^(\s*)source-revision: .*$/m, `$1source-revision: "${revision}"`)
  }

  // Written after the digest so the reason sits beside the thing it explains.
  updated = updated.replace(
    /^(\s*)source-digest: (.*)$/m,
    `$1source-digest: $2\n$1accepted: ${JSON.stringify(why)}`
  )

  await writeFile(path, updated)
  console.log(`${slug}: accepted`)
}
