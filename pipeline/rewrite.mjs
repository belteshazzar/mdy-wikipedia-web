/**
 * The rewriting pass: one article in, one edited document out.
 *
 * It never touches the import. `site/corpus/en/babylon.mdy` is what Wikipedia
 * said at a named revision and stays that way; this writes
 * `edited/en/babylon.mdy`, which records the revision it was made from. That
 * separation is what lets the corpus be re-imported when Wikipedia moves
 * without losing the writing, and what lets a query find every rewrite whose
 * source has changed underneath it.
 *
 * The model is asked for FIELDS, not for better sentences. A magazine page is
 * made of parts — a hook, a standfirst, a caption with a reason, a pull quote —
 * and prose alone cannot be laid out as one. Better prose comes out of the
 * exercise as a by-product, because whoever has to name the one image the page
 * opens on has had to understand the article first.
 *
 * Three things are handled here rather than by the model, because they are
 * mechanical and a model doing them is a model with something to get wrong:
 * the footnote definitions are carried over verbatim, the front matter's
 * records (source, images, wikidata) are copied across, and the section
 * headings are checked against the original rather than trusted.
 *
 *   node pipeline/rewrite.mjs <slug>...        # named articles
 *   node pipeline/rewrite.mjs --tier pillar    # everything, by rank
 *   node pipeline/rewrite.mjs babylon --force  # redo one that exists
 */

import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import YAML from 'yaml'
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-opus-5'
const corpus = 'site/corpus/en'
const out = 'site/edited/en'

/**
 * What the layout consumes, which is the whole reason for the exercise.
 *
 * `strict: true` with `additionalProperties: false` means the response
 * validates exactly, so nothing downstream has to defend against a field that
 * came back a string when it should have been a list.
 */
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'standfirst', 'sections', 'key-facts', 'image-plan', 'glossary'],
  properties: {
    hook: {
      type: 'string',
      description:
        'One or two sentences: the reason a general reader should care, set large under the title. Not a definition. Must be supportable from the article alone.'
    },
    standfirst: {
      type: 'string',
      description:
        'About forty words of orientation before the first section: who, where, when, and why this is worth the next ten minutes.'
    },
    sections: {
      type: 'array',
      description:
        'The rewritten prose, one entry per section of the original, in the original order, with the original headings verbatim. Body is MDY markup: !!bold!!, //italic//, [[ label | target ]] links copied unchanged from the source, and every [[ ^n ]] footnote reference carried across with the claim it supports.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'heading', 'body'],
        properties: {
          id: {type: 'string', description: 'The section id from the original front matter, unchanged.'},
          heading: {type: 'string', description: 'The original heading, verbatim.'},
          body: {type: 'string', description: 'The rewritten prose for this section, as MDY.'}
        }
      }
    },
    'pull-quotes': {
      type: 'array',
      description:
        'Quotations already present in the article, verbatim, with whoever said them. Ancient sources first — Herodotus and Diodorus are better copy than anything written for this page. Empty is a valid answer.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'attribution', 'section'],
        properties: {
          text: {type: 'string'},
          attribution: {type: 'string'},
          section: {type: 'string', description: 'The section id it belongs beside.'}
        }
      }
    },
    timeline: {
      type: 'array',
      description:
        'Dated events, earliest first, from the Wikidata claims first and the prose second. Dates copied exactly as the source spells them.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['when', 'what'],
        properties: {when: {type: 'string'}, what: {type: 'string'}}
      }
    },
    'key-facts': {
      type: 'array',
      description:
        'At most six. The infobox said the way a person would say it — "Built around 2200 BC" rather than "built: c. 2200 BC". Values copied exactly.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'value'],
        properties: {name: {type: 'string'}, value: {type: 'string'}}
      }
    },
    'image-plan': {
      type: 'array',
      description:
        'One entry per image worth showing, using the file names given. Role: hero (exactly one, the picture the page opens on), full, inline, or drop. Caption rewritten to say something rather than to name the file.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'role', 'section', 'caption'],
        properties: {
          file: {type: 'string'},
          role: {type: 'string', enum: ['hero', 'full', 'inline', 'drop']},
          section: {type: 'string', description: 'The section id it belongs in, or "lead".'},
          caption: {type: 'string'}
        }
      }
    },
    glossary: {
      type: 'array',
      description:
        'Terms a general reader will not know, one line each, defined only from what the article says. At most eight.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['term', 'gloss'],
        properties: {term: {type: 'string'}, gloss: {type: 'string'}}
      }
    },
    further: {
      type: 'array',
      description:
        'Up to three "if this held you" pointers, chosen ONLY from the linked articles listed as being in this corpus.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'why'],
        properties: {slug: {type: 'string'}, why: {type: 'string'}}
      }
    },
    'left-out': {
      type: 'string',
      description:
        'Anything you could not do and why — a section with nothing in it you could keep a citation for, a claim you could not source from the document. Empty string if nothing.'
    }
  }
}

/** Split an imported document into the parts each stage owns. */
export function split(source) {
  const match = /^\+\+\+\n([\s\S]*?)\n\+\+\+\n([\s\S]*)$/.exec(source)

  if (!match) throw new Error('no front matter')

  const data = YAML.parse(match[1])
  const body = match[2]
  // Footnote definitions are `[[ ^1 ]]: …` at the foot of the document. They
  // are carried over untouched: they are the citations the prose points at,
  // and a model retyping a hundred bibliography lines is a model with a
  // hundred chances to get one wrong.
  const at = body.search(/^\[\[ \^\d+ \]\]:/m)

  return {
    data,
    prose: at === -1 ? body : body.slice(0, at).trimEnd(),
    notes: at === -1 ? '' : body.slice(at).trimEnd()
  }
}

const system = `You are rewriting an encyclopedia article for a fork of Wikipedia about the ancient world, read by people who are interested rather than obliged.

You are given one article and nothing else, and you may use nothing else. Everything you write must be supportable from the document in front of you: its front matter, its prose, its Wikidata claims. Not from what you know about the subject. This is not a stylistic preference — it is what makes your output checkable, and a verifier will read every claim you write back against this same document.

HOUSE STYLE
{{HOUSE_STYLE}}

WHAT YOU ARE PRODUCING
Fields a magazine page is laid out from, not an essay. The prose matters, but a hook that does not fit above a photograph and a caption that names a file are failures of the same kind.

MECHANICS
- Section headings are reproduced verbatim and every section is present, in order, with its original id.
- Bodies are MDY markup: !!bold!!, //italic//, [[ label | target ]] for links — copy links across unchanged, do not invent new ones — and [[ ^n ]] for footnote references.
- Every [[ ^n ]] in the source belongs with the claim it supports. Carry it. Where you merge two sentences, carry both. A sentence whose citation you cannot carry does not get written.
- Dates, numbers, names, titles, measurements and quotations are transcribed exactly.
- If a section is a list of names, or a table, or otherwise not prose, leave it close to as it was rather than inventing continuity for it.
- Say in "left-out" anything you could not do.`

/** Everything the model is given about one article. */
function prompt(slug, {data, prose}, inCorpus) {
  const records = {
    title: data.title,
    description: data.description,
    coordinates: data.coordinates,
    infobox: data.infobox,
    sections: data.sections,
    wikidata: data.wikidata,
    images: (data.images ?? []).map(({file, caption}) => ({file, caption}))
  }

  return [
    `# The article: ${data.title}`,
    '',
    '## Its records (front matter)',
    '```yaml',
    YAML.stringify(records, {lineWidth: 100}).trimEnd(),
    '```',
    '',
    '## Articles this corpus holds, for "further"',
    inCorpus.join(', '),
    '',
    '## Its prose',
    prose
  ].join('\n')
}

/** The edited document: the rewrite, with the records and notes carried over. */
function compose(slug, original, rewrite, usage) {
  const data = {
    title: original.data.title,
    description: original.data.description,
    hook: rewrite.hook,
    standfirst: rewrite.standfirst,
    'key-facts': rewrite['key-facts'],
    'pull-quotes': rewrite['pull-quotes'],
    timeline: rewrite.timeline,
    'image-plan': rewrite['image-plan'],
    glossary: rewrite.glossary,
    further: rewrite.further,
    // Carried across untouched — the rewrite is of the prose.
    coordinates: original.data.coordinates,
    image: original.data.image,
    images: original.data.images,
    infobox: original.data.infobox,
    sections: original.data.sections,
    wikidata: original.data.wikidata,
    'link-titles': original.data['link-titles'],
    source: original.data.source,
    rewritten: {
      of: `corpus/en/${slug}.mdy`,
      // What a stale rewrite is found by: re-import, then query for a source
      // revision that no longer matches this one.
      'source-revision': original.data.source?.revision,
      model: MODEL,
      'left-out': rewrite['left-out'] || undefined,
      verified: false,
      reviewed: false
    }
  }

  const body = rewrite.sections
    .map((section) => `== ${section.heading}\n\n${section.body.trim()}`)
    .join('\n\n')

  return `+++\n${YAML.stringify(data, {lineWidth: 78}).trimEnd()}\n+++\n${body}\n\n${original.notes}\n`
}

// ------------------------------------------------------------------- run

const args = process.argv.slice(2)
const force = args.includes('--force')
const slugs = args.filter((a) => !a.startsWith('--'))

if (!slugs.length) {
  console.error('usage: node pipeline/rewrite.mjs <slug>... [--force]')
  process.exit(1)
}

const houseStyle = await readFile('docs/house-style.md', 'utf8')
const present = (await readdir(corpus))
  .filter((n) => n.endsWith('.mdy'))
  .map((n) => n.slice(0, -4))
const client = new Anthropic()

for (const slug of slugs) {
  const target = join(out, `${slug}.mdy`)

  if (!force && (await readFile(target, 'utf8').catch(() => undefined))) {
    console.log(`${slug}: already rewritten (--force to redo)`)
    continue
  }

  const original = split(await readFile(join(corpus, `${slug}.mdy`), 'utf8'))

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: {type: 'adaptive'},
    output_config: {effort: 'high', format: {type: 'json_schema', schema}},
    system: [
      {
        type: 'text',
        text: system.replace('{{HOUSE_STYLE}}', houseStyle),
        cache_control: {type: 'ephemeral'}
      }
    ],
    messages: [{role: 'user', content: prompt(slug, original, present)}]
  })

  const message = await stream.finalMessage()

  if (message.stop_reason === 'refusal') {
    console.error(`${slug}: refused (${message.stop_details?.category})`)
    continue
  }

  const text = message.content.find((block) => block.type === 'text')?.text
  const rewrite = JSON.parse(text)

  // The headings are checked rather than trusted: the outline, the contents
  // rail and every incoming fragment link are built from them.
  const wanted = (original.data.sections ?? []).map((s) => s.id)
  const got = rewrite.sections.map((s) => s.id)
  const lost = wanted.filter((id) => !got.includes(id))

  if (lost.length) console.warn(`${slug}: sections missing — ${lost.join(', ')}`)

  await mkdir(dirname(target), {recursive: true})
  await writeFile(target, compose(slug, original, rewrite, message.usage))

  console.log(
    `${slug}: ${rewrite.sections.length} sections, ` +
      `${rewrite['image-plan'].length} images planned, ` +
      `${message.usage.input_tokens} in / ${message.usage.output_tokens} out`
  )
}
