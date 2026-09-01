/**
 * Run the rewriting pass, or hand it to something else to run.
 *
 * What is asked and what is done with the answer live in `document.mjs`, so
 * both transports below go through exactly the same prompt and exactly the
 * same document surgery. Only who makes the call differs.
 *
 *   node pipeline/rewrite.mjs <slug>...              # over the API
 *   node pipeline/rewrite.mjs --body <slug>...       # the cheaper tier
 *   node pipeline/rewrite.mjs --emit <slug>...       # write the request out
 *   node pipeline/rewrite.mjs --apply <slug> <json>  # take an answer back in
 *
 * `--emit` and `--apply` are the pair that lets the pass run somewhere without
 * an API key — a Claude Code subagent, a console, a colleague — without
 * anything about the request changing. The prompt a subagent answers is the
 * prompt `rewrite.mjs` would have sent, byte for byte.
 */

import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import YAML from 'yaml'
import {compose, CORPUS, MODEL_ID, OUT, request, split} from './document.mjs'

// Every image the corpus has the rights to, by the name it is filed under.
// A plan naming anything else is naming a picture that will not appear, and
// silently: the layout looks it up, misses, and lays out the page without it.
const manifest = YAML.parse(
  await readFile(join(CORPUS, '..', 'images.yaml'), 'utf8').catch(() => 'images: {}')
)
const licensed = new Set(Object.keys(manifest.images ?? {}))

const args = process.argv.slice(2)
const mode = args.includes('--emit') ? 'emit' : args.includes('--apply') ? 'apply' : 'api'
const tier = args.includes('--body') ? 'body' : 'pillar'
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

  // A file name is transcribed rather than chosen, and a transcription can
  // drift — `Akerblad.jpg` for `Åkerblad.jpg` costs a picture and says
  // nothing. Checked here because it is checkable here.
  const unknown = (rewrite['image-plan'] ?? [])
    .filter((entry) => entry.role !== 'drop' && licensed.size && !licensed.has(entry.file))
    .map((entry) => entry.file)

  if (unknown.length) {
    console.warn(`  ${slug}: image plan names ${unknown.length} file(s) with no rights record`)
    for (const file of unknown) console.warn(`    ${file}`)
  }

  // Each planned picture has to name a section that exists, or it lands
  // nowhere.
  const ids = new Set([...wanted, 'lead'])
  const homeless = (rewrite['image-plan'] ?? [])
    .filter((entry) => entry.role !== 'drop' && entry.section && !ids.has(entry.section))
    .map((entry) => `${entry.file} → ${entry.section}`)

  if (homeless.length) {
    console.warn(`  ${slug}: image plan names ${homeless.length} unknown section(s)`)
    for (const line of homeless) console.warn(`    ${line}`)
  }

  const target = join(OUT, `${slug}.mdy`)
  const before = await readFile(target, 'utf8').catch(() => undefined)
  const composed = compose(slug, original, rewrite)

  await mkdir(dirname(target), {recursive: true})
  await writeFile(target, composed)

  // A re-applied rewrite is usually new text, and a verdict on the old text is
  // void — the document loses it by being rewritten, and the report beside it
  // has to go too or `status.mjs` reads a verdict for prose that is gone.
  //
  // Usually, not always. Re-applying an unchanged answer after a fix to the
  // pipeline — recovering the lettered footnote definitions, say — leaves the
  // prose identical, and throwing away 41 verdicts to re-earn them unchanged
  // is not diligence. So the prose decides, not the act of applying.
  const same = before !== undefined && split(before).prose === split(composed).prose

  if (!same) {
    await rm(join(OUT, `${slug}.verify.yaml`), {force: true})
  } else {
    // Keeping the report on disk is not enough: `compose` writes a fresh
    // `verified: false` every time, so the verdict has to be put back into the
    // document too or `status.mjs` reads 41 unverified rewrites that were all
    // verified a minute ago.
    const report = await readFile(join(OUT, `${slug}.verify.yaml`), 'utf8').catch(() => undefined)

    if (report) {
      const parsed = YAML.parse(report)
      const restored = composed.replace(
        /^(\s*)verified: false$/m,
        `$1verified: ${parsed.verdict === 'blocked' ? 'false' : 'true'}\n$1verdict: ${parsed.verdict}` +
          ((parsed.findings ?? []).length ? `\n$1findings: ${parsed.findings.length}` : '')
      )

      await writeFile(target, restored)
      console.log(`  ${slug}: prose unchanged, verdict ${parsed.verdict} kept`)
    }
  }

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
    const {system, user, schema} = await request(slug, await load(slug), present, {tier})
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

    console.log(
      `${path}  ${tier} tier, ${Math.round((system.length + user.length) / 4000)}k tokens, roughly`
    )
  }
} else {
  const {default: Anthropic} = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

  for (const slug of rest) {
    const original = await load(slug)
    const {system, user, schema} = await request(slug, original, present, {tier})

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
