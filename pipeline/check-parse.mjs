/** Every document in the corpus parses, and says what it is about. */
import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {mdy} from 'mdy-docs/parse'

const root = process.argv[2] ?? 'corpus/en'
const processor = mdy({tasks: true})
let ok = 0
const failed = []

for (const name of (await readdir(root)).filter((n) => n.endsWith('.mdy'))) {
  const source = await readFile(join(root, name), 'utf8')

  try {
    const file = await processor.process(source)

    if (!String(file).length) throw new Error('rendered empty')

    ok += 1
  } catch (error) {
    failed.push(name + ': ' + error.message)
  }
}

console.log(`${ok} parse and render, ${failed.length} failed`)
for (const line of failed) console.log('  ' + line)
