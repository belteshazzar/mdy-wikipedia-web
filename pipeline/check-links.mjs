/**
 * How much of the corpus's link graph stays inside the corpus.
 *
 * `--links wiki` writes `[[ Babylonia ]]`, and mdy resolves that against the
 * directory the document is in — so a link is internal exactly when the file
 * it names is there. Babylon links to 292 pages and this corpus holds 41, so
 * the answer is never "all of them", and demanding that it were would only
 * mean importing Wikipedia.
 *
 * The number that matters is the ratio: it says whether the corpus boundary
 * was drawn around a subject or across one. A low ratio is a corpus that
 * reads as a set of articles about unrelated things; a high one is a fork.
 *
 * Reports the outbound links nobody in the corpus answers, most-wanted first,
 * which is also the shortlist for what to import next.
 */

import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {defaultResolve, parseWikiLink} from 'mdy-docs/parse/wiki.js'

const root = process.argv[2] ?? 'corpus/en'
const files = (await readdir(root)).filter((name) => name.endsWith('.mdy'))
const present = new Set(files.map((name) => name.slice(0, -'.mdy'.length)))

let internal = 0
let external = 0
/** @type {Map<string, {count: number, from: Set<string>}>} */
const wanted = new Map()

for (const name of files) {
  const source = await readFile(join(root, name), 'utf8')
  let index = 0

  while ((index = source.indexOf('[[', index)) !== -1) {
    const link = parseWikiLink(source, index)

    index += link ? link.length : 2

    // A footnote is `[[ ^3 ]]` and a citation's link to a newspaper is a URL;
    // neither is a link to an article, so neither is asked about.
    if (!link || !link.url || /^\^/.test(link.url) || /^[a-z]+:/i.test(link.url)) continue

    const target = defaultResolve(link.url).replace(/^\/+/, '')

    if (present.has(target)) {
      internal += 1
      continue
    }

    external += 1

    const entry = wanted.get(target) ?? {count: 0, from: new Set()}

    entry.count += 1
    entry.from.add(name.slice(0, -'.mdy'.length))
    wanted.set(target, entry)
  }
}

const total = internal + external
const ratio = total ? ((internal / total) * 100).toFixed(1) : '0.0'

console.log(`${files.length} documents, ${total} article links`)
console.log(`  internal  ${internal}  (${ratio}%)  — resolve to a file beside them`)
console.log(`  outbound  ${external}  (${(100 - Number(ratio)).toFixed(1)}%)  — not in the corpus`)
console.log(`  distinct pages wanted: ${wanted.size}`)
console.log('\nmost-wanted, by how many documents ask for them:')

const ranked = [...wanted]
  .sort((a, b) => b[1].from.size - a[1].from.size || b[1].count - a[1].count)
  .slice(0, 20)

for (const [target, {count, from}] of ranked) {
  console.log(`  ${String(from.size).padStart(3)} docs, ${String(count).padStart(4)} links  ${target}`)
}
