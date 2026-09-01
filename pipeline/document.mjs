/**
 * The rewriting pass: what is asked of the model, and what is done with the
 * answer. The transport is `rewrite.mjs`'s; none of it is here, so the same
 * prompt and the same document surgery are used whether the answer came back
 * over HTTPS or was written into a file by hand.
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
 * */

import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import YAML from 'yaml'

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
export const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'standfirst', 'lead', 'sections', 'key-facts', 'image-plan', 'glossary'],
  properties: {
    hook: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'from'],
      description:
        'One or two sentences: the reason a general reader should care, set large under the title. Not a definition.',
      properties: {
        text: {type: 'string'},
        from: {
          type: 'string',
          description:
            'The sentence or sentences from the article that this compresses, copied VERBATIM. Everything the hook asserts must be visible here. If you cannot quote a passage that supports all of it, the hook claims too much and must be rewritten until you can.'
        }
      }
    },
    standfirst: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'from'],
      description:
        'About forty words of orientation before the first section: who, where, when, and why this is worth the next ten minutes.',
      properties: {
        text: {type: 'string'},
        from: {type: 'string', description: 'The passage it compresses, copied VERBATIM, as for the hook.'}
      }
    },
    lead: {
      type: 'string',
      description:
        'The prose above the first heading, rewritten — the paragraphs that orient a reader before any section begins. This is the most-read part of the article and it is NOT the hook or the standfirst, which are much shorter and sit above it. MDY markup, with links and [[ ^n ]] footnote references carried across as everywhere else.'
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
        required: ['when', 'what', 'from'],
        properties: {
          when: {type: 'string'},
          what: {type: 'string'},
          from: {type: 'string', description: 'The passage this is taken from, copied VERBATIM.'}
        }
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
        required: ['term', 'gloss', 'from'],
        properties: {
          term: {type: 'string'},
          gloss: {type: 'string'},
          from: {type: 'string', description: 'The passage the gloss is taken from, copied VERBATIM.'}
        }
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
  //
  // ANY label, not just a number. Wikipedia's explanatory notes are lettered,
  // and in 7 of these 41 documents the block starts with one — so searching
  // for the first NUMBERED definition put every lettered note above it into
  // the prose instead: fed to the model as noise, and not carried across.
  // Koine Greek lost two of its three that way, which is how this was found.
  const at = body.search(/^\[\[ \^\w+ \]\]:/m)

  return {
    data,
    prose: at === -1 ? body : body.slice(0, at).trimEnd(),
    notes: at === -1 ? '' : body.slice(at).trimEnd()
  }
}

export const system = `You are rewriting an encyclopedia article for a fork of Wikipedia about the ancient world, read by people who are interested rather than obliged.

You are given one article and nothing else, and you may use nothing else. Everything you write must be supportable from the document in front of you: its front matter, its prose, its Wikidata claims. Not from what you know about the subject. This is not a stylistic preference — it is what makes your output checkable, and a verifier will read every claim you write back against this same document.

HOUSE STYLE
{{HOUSE_STYLE}}

WHAT YOU ARE PRODUCING
Fields a magazine page is laid out from, not an essay. The prose matters, but a hook that does not fit above a photograph and a caption that names a file are failures of the same kind.

THE SHORT FIELDS ARE WHERE THIS GOES WRONG
The hook, standfirst, timeline and glossary are a twentieth of the words and, measured over ten articles, seven times more likely to say something the article does not. The cause is not carelessness, it is compression: the shortest arresting version of a hedged claim is the unhedged one. "Knowledge of it derives principally from funerary texts, among many other sources" does not fit above a photograph; "known only from funerary texts" does, and is false.

So each of those fields carries a \`from\`: the passage it compresses, copied out of the article word for word. Write the quote first and the field second. If what you have written asserts more than the quote does — a hedge dropped, a scope widened, an actor supplied, a cause implied — then it is the field that is wrong, not the quote, and you rewrite it until the quote covers it.

MECHANICS
- The article's LEAD — the prose above its first heading — is rewritten into "lead". It is the most-read part of the article. The hook and the standfirst do not replace it; they sit above it and are much shorter.
- Section headings are reproduced verbatim and every section is present, in order, with its original id.
- A quotation set off on its own is a block quote, written as an element:

    < blockquote
      The words, indented two columns under it.

  MDY has no closing tags — the indent is the element, and it ends where the
  indent does. Two rewrites flattened block quotes to inline because they were
  told the inline markup and not this.
- Bodies are MDY markup: !!bold!!, //italic//, [[ label | target ]] for links — copy links across unchanged, do not invent new ones — and [[ ^n ]] for footnote references.
- Every [[ ^n ]] in the source belongs with the claim it supports. Carry it. Where you merge two sentences, carry both. A sentence whose citation you cannot carry does not get written.
- Dates, numbers, names, titles, measurements and quotations are transcribed exactly.
- If a section is a list of names, or a table, or otherwise not prose, leave it close to as it was rather than inventing continuity for it.
- Say in "left-out" anything you could not do.`

/** Everything the model is given about one article. */
export function prompt(slug, {data, prose}, inCorpus) {
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

/**
 * What a short field says.
 *
 * Three shapes to survive: absent (body tier does not ask for these at all), a
 * bare string (answers written before the fields carried anchors), and the
 * `{text, from}` pair they carry now.
 */
const said = (field) =>
  field === undefined || field === null
    ? undefined
    : typeof field === 'string'
      ? field
      : field.text

/** The quotes a reviewer checks the short fields against, if there are any. */
function anchored(rewrite) {
  const out = {}

  for (const key of ['hook', 'standfirst']) {
    const field = rewrite[key]

    if (field && typeof field === 'object' && field.from) out[key] = field.from
  }

  return Object.keys(out).length ? out : undefined
}

/** What the prose was, in sixteen characters. */
export const digest = (prose) =>
  createHash('sha256').update(String(prose)).digest('hex').slice(0, 16)

/** The edited document: the rewrite, with the records and notes carried over. */
export function compose(slug, original, rewrite, usage) {
  const data = {
    title: original.data.title,
    description: original.data.description,
    hook: said(rewrite.hook),
    standfirst: said(rewrite.standfirst),
    'key-facts': rewrite['key-facts'],
    'pull-quotes': rewrite['pull-quotes'],
    timeline: rewrite.timeline,
    'image-plan': rewrite['image-plan'],
    glossary: rewrite.glossary,
    further: rewrite.further,
    // What each short field is compressing, kept rather than thrown away: it
    // is what a reviewer checks the field against, and checking a hook against
    // its own quote is a ten-second job where re-reading the article is not.
    anchors: anchored(rewrite),
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
      // The corpus prose this document was last composed against.
      //
      // A currency marker, not a provenance claim — it says "this rewrite is
      // up to date with respect to that source", which is the question
      // `status.mjs` asks. Re-composing an unchanged answer against a
      // corrected corpus refreshes it without the model having run again, and
      // that is correct: the rewrite IS current with the new source.
      //
      // It exists because the revision below is not enough. That catches
      // Wikipedia moving under us; it does not catch this pipeline importing
      // the same revision differently — and it did. Turning off
      // `--drop-pronunciation` gave Koine Greek back 5,804 characters of
      // phonology at an unchanged revision. Both kinds of drift are real and
      // only one of them has a revision number.
      'source-digest': digest(original.prose),
      // What a stale rewrite is found by: re-import, then query for a source
      // revision that no longer matches this one.
      'source-revision': original.data.source?.revision,
      model: MODEL,
      'left-out': rewrite['left-out'] || undefined,
      verified: false,
      reviewed: false
    }
  }

  // The lead is prose above the first heading, exactly as the import has it.
  // It is not a section, has no id, and is the part most readers read.
  const body = [
    (rewrite.lead ?? '').trim(),
    ...rewrite.sections.map((section) =>
      section.heading
        ? `== ${section.heading}\n\n${section.body.trim()}`
        : section.body.trim()
    )
  ]
    .filter(Boolean)
    .join('\n\n')

  return `+++\n${YAML.stringify(data, {lineWidth: 78}).trimEnd()}\n+++\n${body}\n\n${original.notes}\n`
}


export const MODEL_ID = MODEL
export const CORPUS = corpus
export const OUT = out

/**
 * The cheap tier, and it is not the one this plan first proposed.
 *
 * The original tiering gave a body-tier article a hook, a standfirst and an
 * image plan and left the prose as imported — which, measured over ten
 * articles, is spending the budget on precisely the fields that fail seven
 * times as often per word, with no rewritten prose around them to anchor
 * anything. So the cheap tier is the other way up: the prose, which is the
 * safe part, and none of the short fields, which are the dangerous one. A
 * body-tier page keeps the article's own description where a standfirst would
 * go, and looks after itself.
 */
const risky = ['hook', 'standfirst', 'pull-quotes', 'timeline', 'glossary']

function forTier(tier) {
  if (tier !== 'body') return schema

  const properties = {...schema.properties}

  for (const key of risky) delete properties[key]

  return {
    ...schema,
    required: schema.required.filter((key) => !risky.includes(key)),
    properties
  }
}

const bodyNote = `
THIS ARTICLE IS BODY TIER
You are writing the lead, the sections, the key facts and the image plan, and NOT a hook, a standfirst, pull quotes, a timeline or a glossary — those fields are not in your schema and must not appear in your answer. The page will use the article's own one-line description where a standfirst would go.`

/** The two halves of the request, exactly as either transport would send them. */
export async function request(slug, original, inCorpus, options = {}) {
  const houseStyle = await readFile('docs/house-style.md', 'utf8')
  const tier = options.tier ?? 'pillar'

  return {
    system: system.replace('{{HOUSE_STYLE}}', houseStyle) + (tier === 'body' ? bodyNote : ''),
    user: prompt(slug, original, inCorpus),
    schema: forTier(tier),
    tier
  }
}
