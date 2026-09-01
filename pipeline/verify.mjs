/**
 * The verifier: does the rewrite say anything the article did not?
 *
 * Not a review of style. A diff of facts, and a blocking one — this is the
 * mitigation for the risk that decides whether a fork of an encyclopedia is
 * worth anything at all, which is that a model rewriting history will invent a
 * plausible date and nobody will notice.
 *
 * It is a second call, given the original and the rewrite and told to find
 * what is in the second and not the first. Deliberately not the same call as
 * the rewrite: a model asked to check its own work has already decided the
 * work is right. It is cheap relative to the rewrite because it reads two
 * documents and writes a list.
 *
 *   node pipeline/verify.mjs <slug>...              # over the API
 *   node pipeline/verify.mjs --emit <slug>...       # write the request out
 *   node pipeline/verify.mjs --apply <slug> <json>  # take an answer back in
 *
 * The same emit/apply pair the rewriting pass has, and for the same reason:
 * the check has to be able to run wherever, without the request changing.
 */

import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import YAML from 'yaml'
import {split} from './document.mjs'

const MODEL = 'claude-opus-5'
const corpus = 'site/corpus/en'
const edited = 'site/edited/en'

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'verdict'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'quote', 'why', 'severity'],
        properties: {
          kind: {
            type: 'string',
            enum: [
              'unsupported',      // said, but the source does not say it
              'altered-value',    // a date, number, name or measurement changed
              'dropped-hedge',    // the source's uncertainty was removed
              'lost-citation',    // a claim that had a footnote no longer does
              'contradiction'     // the source says the opposite
            ]
          },
          quote: {type: 'string', description: 'The sentence from the rewrite, verbatim.'},
          why: {type: 'string', description: 'What the source says instead, or that it says nothing.'},
          severity: {type: 'string', enum: ['blocking', 'minor']}
        }
      }
    },
    verdict: {
      type: 'string',
      enum: ['clean', 'minor-only', 'blocked'],
      description: 'blocked if any finding is blocking.'
    }
  }
}

const system = `You are checking a rewritten encyclopedia article against the source it was rewritten from.

Your only question is whether the rewrite says anything the source does not support. You are not reviewing the writing. Do not comment on tone, structure, length, or whether the rewrite is an improvement — a finding about style is a finding you should not report.

What counts:
- A claim the source does not make. This includes true things: the rewriter was working closed-book, and a correct fact that is not in the source is still a fabrication as far as this pipeline is concerned.
- A date, number, name, title, measurement or quotation that differs from the source, however slightly. "c. 2200 BC" becoming "around 2200 BC" is an altered value. So is "twelve" becoming "a dozen" if the source counted.
- A hedge removed: the source says "probably" or "according to Herodotus" and the rewrite states it flat.
- A claim that carried a footnote reference in the source and carries none in the rewrite.
- Anything the source contradicts.

Severity is blocking for anything a reader would be misled by, minor for a rephrasing that is loose but not wrong.

Be specific and be sparing. A long list of speculative findings is worse than a short list of real ones, because it will not be read. If the rewrite is faithful, say so with an empty list.`

/** Everything the checker is given about one pair, as either transport sends it. */
function question(source, rewrite) {
  return [
    '# SOURCE — what Wikipedia said',
    '',
    '## Its records',
    '```yaml',
    YAML.stringify(
      {infobox: source.data.infobox, wikidata: source.data.wikidata},
      {lineWidth: 100}
    ).trimEnd(),
    '```',
    '',
    '## Its prose',
    source.prose,
    '',
    '# REWRITE — what this page now says',
    '',
    '## Its fields',
    '```yaml',
    YAML.stringify(
      {
        hook: rewrite.data.hook,
        standfirst: rewrite.data.standfirst,
        'key-facts': rewrite.data['key-facts'],
        'pull-quotes': rewrite.data['pull-quotes'],
        timeline: rewrite.data.timeline,
        glossary: rewrite.data.glossary
      },
      {lineWidth: 100}
    ).trimEnd(),
    '```',
    '',
    '## Its prose',
    rewrite.prose
  ].join('\n')
}

/** Record a verdict in the document itself, so publishability is a query. */
async function land(slug, raw, report) {
  const updated = raw.replace(
    /^(\s*)verified: false$/m,
    `$1verified: ${report.verdict === 'blocked' ? 'false' : 'true'}\n$1verdict: ${report.verdict}` +
      (report.findings.length ? `\n$1findings: ${report.findings.length}` : '')
  )

  await writeFile(join(edited, `${slug}.mdy`), updated)
  await writeFile(
    join(edited, `${slug}.verify.yaml`),
    YAML.stringify({slug, ...report}, {lineWidth: 78})
  )

  const bad = report.findings.filter((f) => f.severity === 'blocking')

  console.log(
    `${slug}: ${report.verdict}` +
      (report.findings.length ? ` — ${report.findings.length} findings, ${bad.length} blocking` : '')
  )

  for (const finding of report.findings) {
    console.log(`    [${finding.severity}/${finding.kind}] ${finding.quote.slice(0, 100)}`)
  }

  return report.verdict === 'blocked'
}

const args = process.argv.slice(2)
const mode = args.includes('--emit') ? 'emit' : args.includes('--apply') ? 'apply' : 'api'
const slugs = args.includes('--all')
  ? (await readdir(edited).catch(() => [])).filter((n) => n.endsWith('.mdy')).map((n) => n.slice(0, -4))
  : args.filter((a) => !a.startsWith('--'))

if (!slugs.length) {
  console.error('usage: node pipeline/verify.mjs <slug>... | --all')
  process.exit(1)
}

let blocked = 0

if (mode === 'apply') {
  const [slug, answer] = slugs

  if (!slug || !answer) throw new Error('usage: --apply <slug> <report.json>')

  const raw = await readFile(join(edited, `${slug}.mdy`), 'utf8')

  if (await land(slug, raw, JSON.parse(await readFile(answer, 'utf8')))) blocked += 1
} else if (mode === 'emit') {
  const dir = 'pipeline/checks'

  await mkdir(dir, {recursive: true})

  for (const slug of slugs) {
    const source = split(await readFile(join(corpus, `${slug}.mdy`), 'utf8'))
    const rewrite = split(await readFile(join(edited, `${slug}.mdy`), 'utf8'))
    const path = join(dir, `${slug}.md`)

    await writeFile(
      path,
      [
        system,
        '',
        '---',
        '',
        question(source, rewrite),
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

    console.log(path)
  }
} else {
  const {default: Anthropic} = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

  for (const slug of slugs) {
    const source = split(await readFile(join(corpus, `${slug}.mdy`), 'utf8'))
    const raw = await readFile(join(edited, `${slug}.mdy`), 'utf8')

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: {type: 'adaptive'},
      output_config: {effort: 'high', format: {type: 'json_schema', schema}},
      system: [{type: 'text', text: system, cache_control: {type: 'ephemeral'}}],
      messages: [{role: 'user', content: question(source, split(raw))}]
    })

    const message = await stream.finalMessage()

    if (await land(slug, raw, JSON.parse(message.content.find((b) => b.type === 'text').text))) {
      blocked += 1
    }
  }
}

if (blocked) {
  console.error(`\n${blocked} of ${slugs.length} blocked — not publishable`)
  process.exit(1)
}
