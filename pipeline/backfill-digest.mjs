/**
 * Give the existing rewrites the fingerprint they were written without.
 *
 * Run BEFORE a re-import, while `site/corpus/` is still the prose these
 * rewrites were actually made from — afterwards there is no way to know what
 * they were made from, which is the whole reason for the field.
 */
import {readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {digest, split} from './document.mjs'

let done = 0

for (const name of (await readdir('site/edited/en')).filter((n) => n.endsWith('.mdy'))) {
  const slug = name.slice(0, -4)
  const raw = await readFile(join('site/edited/en', name), 'utf8')

  if (/^\s*source-digest:/m.test(raw)) continue

  const source = split(await readFile(join('site/corpus/en', `${slug}.mdy`), 'utf8'))
  const updated = raw.replace(
    /^(\s*)of: (corpus\/en\/.*)$/m,
    `$1of: $2\n$1source-digest: ${digest(source.prose)}`
  )

  if (updated === raw) { console.warn(`${slug}: no anchor to write after`); continue }

  await writeFile(join('site/edited/en', name), updated)
  done += 1
}

console.log(`fingerprinted ${done} rewrites against the corpus they were made from`)
