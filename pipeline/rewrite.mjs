/**
 * Run the rewriting pass, or hand it to something else to run.
 *
 * What is asked and what is done with the answer live in `document.mjs`, so
 * both transports below go through exactly the same prompt and exactly the
 * same document surgery. Only who makes the call differs.
 *
 *   node pipeline/rewrite.mjs <slug>...              # over the API
 *   node pipeline/rewrite.mjs --emit <slug>...       # write the request out
 *   node pipeline/rewrite.mjs --apply <slug> <json>  # take an answer back in
 *
 * `--emit` and `--apply` are the pair that lets the pass run somewhere without
 * an API key — a Claude Code subagent, a console, a colleague — without
 * anything about the request changing. The prompt a subagent answers is the
 * prompt `rewrite.mjs` would have sent, byte for byte.
 */

import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {compose, CORPUS, MODEL_ID, OUT, request, split} from './document.mjs'

const args = process.argv.slice(2)
const mode = args.includes('--emit') ? 'emit' : args.includes('--apply') ? 'apply' : 'api'
const rest = args.filter((a) => !a.startsWith('--'))

const present = (await readdir(CORPUS))
  .filter((n) => n.endsWith('.mdy'))
  .map((n) => n.slice(0, -4))

/** Read one imported article. */
const load = async (slug) => split(await readFile(join(CORPUS, `${slug}.mdy`), 'utf8'))

/** Write the finished document, checking the structure the layout depends on. */
async function land(slug, original, rewrite) {
  const wanted = (original.data.sections ?? []).map((s) => s.id)
  const got = rewrite.sections.map((s) => s.id)
  const lost = wanted.filter((id) => !got.includes(id))

  if (lost.length) console.warn(`  ${slug}: sections missing — ${lost.join(', ')}`)

  const target = join(OUT, `${slug}.mdy`)

  await mkdir(dirname(target), {recursive: true})
  await writeFile(target, compose(slug, original, rewrite))

  console.log(
    `${slug}: ${rewrite.sections.length} sections, ` +
      `${(rewrite['image-plan'] ?? []).length} images planned, ` +
      `${(rewrite['pull-quotes'] ?? []).length} quotes, ` +
      `${(rewrite.timeline ?? []).length} dated events` +
      (rewrite['left-out'] ? `\n  left out: ${rewrite['left-out']}` : '')
  )
}

if (mode === 'apply') {
  const [slug, answer] = rest

  if (!slug || !answer) throw new Error('usage: --apply <slug> <response.json>')

  await land(slug, await load(slug), JSON.parse(await readFile(answer, 'utf8')))
} else if (mode === 'emit') {
  const dir = 'pipeline/requests'

  await mkdir(dir, {recursive: true})

  for (const slug of rest) {
    const {system, user, schema} = await request(slug, await load(slug), present)
    const path = join(dir, `${slug}.md`)

    await writeFile(
      path,
      [
        system,
        '',
        '---',
        '',
        user,
        '',
        '---',
        '',
        '# Answer with JSON matching this schema, and nothing else',
        '',
        '```json',
        JSON.stringify(schema, null, 2),
        '```'
      ].join('\n')
    )

    console.log(`${path}  (${Math.round((system.length + user.length) / 4000)}k tokens, roughly)`)
  }
} else {
  const {default: Anthropic} = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

  for (const slug of rest) {
    const original = await load(slug)
    const {system, user, schema} = await request(slug, original, present)

    const stream = client.messages.stream({
      model: MODEL_ID,
      max_tokens: 64000,
      thinking: {type: 'adaptive'},
      output_config: {effort: 'high', format: {type: 'json_schema', schema}},
      system: [{type: 'text', text: system, cache_control: {type: 'ephemeral'}}],
      messages: [{role: 'user', content: user}]
    })

    const message = await stream.finalMessage()

    if (message.stop_reason === 'refusal') {
      console.error(`${slug}: refused (${message.stop_details?.category})`)
      continue
    }

    await land(slug, original, JSON.parse(message.content.find((b) => b.type === 'text').text))
  }
}
