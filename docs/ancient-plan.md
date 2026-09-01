# an ancient-history fork of Wikipedia — implementation plan

Take the Wikipedia articles about the ancient world, convert them to mdy,
rewrite them for a reader who is interested rather than obliged, and render
the whole corpus as one script-defined site. Two goals, and they are not
independent: the prose should be worth reading, and the page it lands on
should be worth looking at.

The worked example throughout is the 42 documents already in
[`vault/`](../vault) — Babylon, Assyria, the Rosetta Stone, Alexandria — and
every claim below about what is and is not in them was checked against the
files, not assumed.

## The one idea

The instinct is to hand an article to an agent, ask for something more
engaging, and then design a page around whatever comes back. That fails in a
way worth naming up front: a wall of livelier paragraphs still has no hero,
no standfirst, no pull quote, no image with a stated reason to be that size.
The result is Wikipedia in a nicer font, which is a thin proposition and an
expensive one.

A magazine page is made of *parts*. So the rewriting pass is not asked for
better sentences — it is asked for **the fields the layout consumes**: a
hook, a standfirst, a per-section image plan, quotes taken verbatim from the
ancient sources the article already cites, a timeline, a glossary. Better
prose falls out of that, because a writer who has to name the one image that
earns the top of the page has had to understand the article first.

The consequence for the phasing is the whole of it: **the design comes
before the rewriting.** You cannot specify the fields until you have drawn
the page that eats them, and a site built from unrewritten documents is
still a site, which makes phase 1 shippable on its own.

## What is already built

Most of this plan is wiring, and it is worth being precise about how much.

| Needed | Where it already is |
| --- | --- |
| Wikipedia → document, with the infobox as a record | `@mdy-docs/mdy-wikipedia`, all four phases landed |
| Bulk import, cross-linked, rate-limited, cached | its `--from` / `--category` / `--follow` / `--delay` |
| Wikidata claims, dated and rank-aware | its `--wikidata`, on by default |
| A queryable set over a directory of documents | mdy-docs' `openDocumentSet` / `$.find` |
| Static site generation, layouts, feeds, search index | mdy-docs' script-defined sites |
| A swappable visual identity | the `examples/blog` ÷ `examples/blog-style-x` split |
| Reviewing a conversion against its source, side by side | this repository |

What is genuinely new is four things: a corpus query, an image enrichment
step, the rewriting pass and its verifier, and the site itself. Everything
else is a flag.

## Why not scrape, and why not the dumps

`src/fetch.js` in the converter reads **Parsoid HTML** from
`/api/rest_v1/page/html/{title}`, plus the summary endpoint, the Action API
for categories and langlinks, and Wikidata. That is the right source and it
is already the one in use.

Scraping the rendered website would mean parsing the presentation layer —
navigation chrome, skin-specific classes, lazy-loaded images — which changes
for reasons that have nothing to do with the article, and doing it against a
service that asks politely for the API instead. There is no version of that
which is better than what exists.

The **Wikimedia Enterprise HTML dumps** are the same Parsoid HTML, offline,
as gzipped NDJSON per namespace. They matter past roughly 50,000 articles,
or when a re-run has to be reproducible against a fixed snapshot. They are
also cheap to adopt later rather than now, because `wikipediaToMdy` takes a
`fetch` implementation in its options: the dump is a reader handed to the
existing pipeline, not a second pipeline. Left out of phase 0 deliberately.

Cost of the API path, at the defaults: four requests per article, 100 ms
apart, so on the order of a second and a half each, and free on re-runs
because the fetch layer caches to `~/.cache/mdy-wikipedia`. Five thousand
articles is an afternoon. This is not the constraint anywhere in the plan.

## The pipeline

Six stages, each a function of the last, so each is testable against a
committed fixture with no network and no model.

```
1. select    SPARQL → titles.txt
2. import    mdy-wikipedia --from titles.txt --links wiki   → vault/en/*.mdy
3. enrich    Commons imageinfo + originals + derivatives    → vault, static/
4. rewrite   agent, closed-book, one document in            → edited/en/*.mdy
5. verify    second agent, claims diffed against the source → a blocking report
6. render    mdy build → the site
```

Stages 1–3 produce a corpus. Stage 6 renders it whether or not 4 and 5 ever
ran; that is the point of the ordering.

### 1. Select — a query, not a category

Categories are the obvious handle and the wrong one. Wikipedia's category
graph is a folksonomy with cycles and no consistent depth, and a walk from
*Ancient history* collects the Epic of Gilgamesh alongside films about it.
The converter's `--category` is right for "every article in *Cities in
Iraq*" and wrong for "the ancient world".

Wikidata answers it properly, because the question is about the subjects
rather than about the filing: select by `instance of` against ancient
states, cities, deities and sites; by `inception` or `date of death` before
a cutoff; by `country` resolving to a polity that no longer exists. Resolve
the resulting Q-ids to their `enwiki` sitelinks and that is `titles.txt`.

The same query returns the two numbers that make stage 4 affordable —
sitelink count across languages, and pageviews. They rank the corpus, and
the rank decides which articles are worth an expensive rewrite. Write them
into a `corpus.yaml` beside the vault; a `.yaml` file in a site directory
has its fields merged straight into `meta`, so the site can query the
ranking without a second mechanism.

### 2. Import

One command, and the only thing to say about it is the link mode:

```sh
mdy-wikipedia --from titles.txt \
  --out-dir vault/en --links wiki \
  --categories --lang-links --delay 100
```

`--links wiki` writes `[[ Babylonia ]]` and names each file the way a link
reaches it, so a vault cross-links itself — which is the difference between
a fork and a set of copies pointing home.

> The existing vault was imported with `--links url`. `mesopotamia.mdy`
> alone carries 634 absolute links to `en.wikipedia.org`. This is a
> re-import, not a fix-up, and it is free: the pages are already cached.

### 3. Enrich — where the real work is hiding

The importer writes each image as `file`, `src`, `width`, `height`,
`caption`. That is the right record for an encyclopedia with sidebar
thumbnails and not enough for a design built on large photographs. Three
things are missing and all three are load-bearing:

- **No licence and no author.** Nothing in the front matter records who made
  the picture or on what terms. Commons files are a mix of CC-BY, CC-BY-SA
  and public domain; non-free files live on en.wikipedia rather than Commons
  and carry a fair-use rationale that is *Wikipedia's*, not ours. Showing
  one full-bleed on a fork is a different act from showing it at 250 px in
  an encyclopedia article.
- **The URLs are thumbnails**, 250–500 px, sized for the sidebar they came
  from. Commons thumbnail URLs are templated, so a wider derivative is a
  string substitution — bounded by the `width` already recorded, so nothing
  is upscaled past the original.
- **Nothing is local.** Hot-linking Commons at any real traffic is not a
  plan.

So: ask the Commons API for `imageinfo` with `iiprop=extmetadata`, write
`licence`, `author` and `credit` into each image entry, drop non-free files
from the corpus outright, fetch the originals once, emit the derivative
sizes into `static/`, and record a dominant colour per image so a page does
not reflow as it loads. Small — a few hundred lines — and the best candidate
in this plan for a contribution back into `mdy-wikipedia` itself, since
every consumer of that tool has the same gap.

> `$.resize`, the site generator's image native, handles **PNG only**:
> `src/images.js` says so, and says why — `@jsquash/jpeg` wraps mozjpeg
> through an init shape the PNG and resize codecs do not share. Nearly every
> Wikipedia photograph is a JPEG. Resize in this stage, outside the sandbox,
> where there is no constraint; wiring the JPEG codec is a separate and
> optional job.

### 4. Rewrite

One agent invocation per article, reading the imported document, writing a
**second** document. `vault/` stays the immutable import; `edited/en/` holds
the rewrite, with `source-document` and `source-revision` in its own front
matter.

That separation is not tidiness. It is what makes it possible to re-import
when Wikipedia moves without losing the writing, to find every rewrite whose
source has changed underneath it with a query rather than a memory, and to
review a rewrite against its original in the two-pane reader this repository
already is.

The fields asked for — **proposed, not yet real output**, unlike every other
sample in this document:

```yaml
hook:        one or two sentences: the reason to care, set large
standfirst:  the forty words of orientation before the first section
sections:    rewritten prose, keyed by the ORIGINAL section ids
pull-quotes: verbatim, with attribution
timeline:    [{when, what}], from the dated Wikidata claims first
key-facts:   the infobox, said the way a person would say it
image-plan:  each image → a section, a role, a rewritten caption
glossary:    terms a general reader will not know, one line each
further:     three links, resolved INTO the vault
```

Two of those deserve a note.

`sections` is keyed by the ids the converter already computed, and it
computes them from the document after cleaning, with mdy's own slugifier —
so every id names an anchor that is really in the rendered page. Keeping the
keys means the outline, the table of contents and every incoming fragment
link survive a rewrite that changes every word under them.

`image-plan` exists because the converter puts images in the front matter
and **not in the body**. Placement is therefore genuinely undecided, which
is a gift to an editorial layout and a burden the rewrite has to pick up:
nothing else in the pipeline knows which picture belongs to which section,
and a role — hero, full-bleed, inline, gallery — is a judgement about the
article, not a size.

#### Rules that keep it an encyclopedia

- **Closed-book.** Only what is in the document: front matter, body,
  Wikidata claims. No outside knowledge, ever. It reads as a restriction and
  it is the one thing that makes the output checkable, because every
  sentence has a source in the same file the model was given.
- **Citations ride along.** The converter already made real mdy footnotes. A
  rewritten sentence carries the `[[ ^12 ]]` of the claim it came from, and
  a sentence that cannot keep its citation does not get written. This is the
  line between a fork and a blog.
- **Copy the hard values.** Dates, numbers, names and titles are
  transcribed, not paraphrased. Paraphrase is where `c. 2200 BC` quietly
  becomes *around 2000 BC*, and the front matter is full of values whose
  hedges are the fact — the converter keeps `circa` on a population for
  exactly this reason.
- **A written house style beats instructions.** One page, with three or four
  before/after pairs drawn from this vault, and an explicit ban-list: no
  *imagine standing in the shadow of the ziggurat*, no rhetorical questions,
  no *little did they know*. The failure mode of "make it engaging" is a
  tour-guide voice that is worse than the dry original, and only worked
  examples reliably prevent it.
- **Provenance per document.** Model, date, source revision, tier, and
  whether a human has read it.

### 5. Verify

A second agent, independent of the first, checking every claim, proper noun,
date and number in the rewrite against the source document, and reporting
what it cannot find. Not a review of style — a diff of facts, and a blocking
one.

This is the mitigation for the risk that decides whether the fork is worth
anything at all (below), and it is cheap relative to the rewrite because it
reads two documents and writes a list.

### 6. Render

A script-defined site: one entry document deciding URLs, archetypes and
grouping through `$.find` / `$.render` / `$.emit`, with the entire visual
identity in a **separate style package** imported by path — the
`examples/blog` and `examples/blog-style-x` split, copied deliberately.
Swap the import and only the look changes; design iteration never touches
the pipeline.

Not one template. **Archetypes, chosen from data**, because the infobox type
and Wikidata's `instance of` already say what kind of thing an article is:

- **Article** — a full-bleed hero carrying the hook, a standfirst, then a
  single measured column with images breaking out to full width at section
  boundaries, pull quotes in the margin, a slim sticky outline, a key-facts
  card where the infobox wall was, and glossary hover-cards on first use.
- **Place** — the coordinates are already in the front matter: a map, and
  what is on the site now.
- **Person** — dates and dynasty from the claims, and one line on who they
  were.
- **Era hub and timeline** — written by nobody, generated by query.

## The tiers

A large converted article is around 125,000 characters. That is fine for
hundreds of articles and not for tens of thousands, so the ranking from
stage 1 decides how much each one gets.

| Tier | Articles | What the agent does | Review |
| --- | --- | --- | --- |
| Pillar | ~300 | The full schema, every field | Read by a human |
| Body | ~5,000 | Hook, standfirst, image plan, captions; the imported prose stands | Verifier only |
| Long tail | the rest | Nothing — the imported document, same layouts | — |

A tier-3 page is still a large image, real typography and a clean measure.
It is already better looking than the article it came from; it simply has
not been rewritten. The site is therefore complete on the day it launches,
and gets better where it matters rather than uniformly.

## What the vault does that Wikipedia cannot

Worth stating plainly, because "the same encyclopedia, prettier" is hard to
sustain and this is the part that is not.

Every article's data is a record in one queryable collection. The infobox is
nested rather than flattened, so Babylon's `region` and its World Heritage
listing's `region` both survive and each says which it means. Wikidata's
claims carry the years they held for, which the converter is emphatic about:
Babylon's `country` is twelve statements, and flattening them to twelve
names says Babylon is in twelve countries and that Parthia is two of them.

So `$.find` across the vault writes pages nobody authored. Who ruled
Babylon, century by century, assembled from dated claims. Every article
whose subject stood within 200 km of Nineveh. One timeline of the second
millennium BC built from the whole corpus at once. Those cost a query each,
and they are the reason to come back to the site.

## Attribution, and honesty about the rewrite

The converter already writes `source:` into every document — url, page id,
revision, retrieval date, licence and an attribution sentence — and its plan
has a section arguing that this is a requirement rather than a nicety. The
same holds here, twice over.

Wikipedia's text is CC BY-SA 4.0 and a rewrite is a derivative work. The
fork is therefore CC BY-SA 4.0 as well — it cannot be taken proprietary —
attribution stays, and the pipeline must not drop `source:` on the way
through stages 4 and 5. Images carry their own licences separately, which is
what stage 3 is for.

Beyond the licence: every page says, in the page and not in a policy
document, that it was rewritten with AI assistance from a named article at a
named revision, and links to that revision. A reader of an encyclopedia is
owed that, and a fork that hides it has spent the only thing it has.

## Phases

**Phase 0 — a corpus that cross-links itself.** The SPARQL query, one import
with `--links wiki`, and the Commons enrichment step: licences, authors,
derivatives, non-free files dropped. Exit: a vault whose every internal link
either resolves to a file beside it or knowingly leaves the corpus, and an
image manifest where every entry names its licence and its author. ✅ — see
[what phase 0 landed](#what-phase-0-landed).

**Phase 1 — the style package and the article archetype.** Built against
*unrewritten* documents, which is the point: it proves the design with the
model risk nowhere near it, and it is what settles the schema phase 2 asks
for. Exit: a built site of the phase 0 corpus, article and place archetypes,
that is worth looking at. ✅ — see [what phase 1 landed](#what-phase-1-landed).

**Phase 2 — ten rewrites, read side by side.** The house style, the schema,
the verifier, and ten articles put through all three, compared against their
originals in this repository's reader. Exit: an answer to whether the
rewrite is actually better — decided on ten articles rather than on three
thousand, and a real possibility that the answer is no for the body and yes
for the hook.

**Phase 3 — scale, by tier.** Pillar, body, long tail; verification on
everything; provenance per document. Exit: the corpus, complete, and a query
that lists every stale rewrite.

**Phase 4 — the cross-article pages.** Timelines, era hubs, maps, search.
Exit: at least three pages that no article contains.

## What phase 0 landed

41 articles, 4,417 article links, 475 images with their rights named, in
[`pipeline/`](../pipeline) — which holds the query and the tools, not the
corpus, because `corpus/` is a build and two commands make it.

### Three bugs, found by running it rather than by reading it

**Six of forty-one articles would not import at all.** `wikidataRecord` read
`best[0].mainsnak` off the statements a property has left after rank is
honoured, and Q8409 — Alexander the Great — has two properties whose only
statement is deprecated. `rank()` correctly returned nothing and the next line
read a datatype off it. A property with no live statement now says nothing,
which is what honouring rank means; resurrecting the retracted value would be
the other bug.

**`--links wiki` was writing links into documents that can never exist.**
`Help:IPA/English` slugifies to `helpipa/english` — and because the slugifier
keeps the slash, into a subdirectory as well. The cleaner already knew the
principle and had written it down (*"A link to `File:`, `Help:` or `Category:`
is a link out of the encyclopedia's prose"*); it applied it to which pages
`--follow` visits and not to how the href was rewritten. A page outside the
article namespace now keeps pointing at Wikipedia in every mode. The namespace
test is a canonical prefix list rather than "does the title contain a colon",
so *Rome: Total War* still resolves into the vault.

**680 of 5,570 links were citation machinery.** `ISBN`, `doi`, `JSTOR`,
`S2CID`, `OCLC` — each links to a page named for the scheme, so that a reader
can look the number up. 31 of the 41 documents wanted `isbn-identifier`, which
made it the most-linked "article" in the corpus by a factor of three. The
number stays and the link goes, tallied as `identifier-links` beside the
cleaner's other removals.

All three are fixed in `third-party/mdy-wikipedia` with regression tests, and
none of them is specific to ancient history: any `--links wiki` import hits the
second and third, and any import of a person hits the first.

### The link ratio is the corpus metric

`check-links.mjs` reports what fraction of the link graph stays inside the
corpus. For these 41 articles it is **3.4%** — 151 internal against 4,266
outbound, wanting 2,570 distinct pages.

That number is not a failure, and the exit criterion was wrong as first
written: 41 articles cannot resolve their own links, because Babylon alone
links to 292 pages. What the ratio measures is whether the boundary was drawn
around a subject, and the shape of the answer is more useful than the number —
once the machinery was cleaned out, the pages the corpus most wants are
`akkadian-language`, `egyptian-temple`, `ancient-egypt`, `set-deity`,
`new-kingdom-of-egypt`. That list is the next import, and running it after
every import is how the corpus grows toward being closed rather than wider.

A link that leaves the corpus is not broken — it points at Wikipedia, and the
site should show that it does.

### The image step, and two mistakes of its own

475 of 476 files are on Commons. The one that is not is a local upload to
en.wikipedia, which is where non-free files go precisely because Commons will
not take them; it is dropped with its reason recorded.

Both of the step's own bugs were over-eager drops, caught by disbelieving the
number:

- Keying the manifest by the file name as the front matter spells it, when the
  API answers in normalised titles — `Bronze head of an Akkadian ruler.jpg`
  against `Bronze_head_of_an_Akkadian_ruler.jpg`. 426 files on Commons reported
  as missing.
- Reading `Restrictions` as a copyright status. It is not: it is Commons
  warning that a trademark, an official insignia or a personality right applies
  *on top of* a free licence. It threw away a CC BY-SA 3.0 drawing and the flag
  of Iraq. It now rides along as `caution` for whoever lays the page out, and
  only the licence can drop a file.

Of the 475 kept, **every one names its licence** — 199 public domain, 95
CC BY-SA 4.0, 30 CC0, and so on down — and **every one under a licence that
requires attribution names somebody to attribute**. The twelve with no author
at all are eleven public-domain works and one *copyrighted free use*, none of
which is owed one. Where Commons has no `Artist` for a CC file, the uploader is
credited, which is what Commons itself does.

Two decisions in that step are worth keeping.

**The rights go beside the documents, not into them.** `corpus/images.yaml`,
keyed by file name, joined against `images[].file`. Writing licences back into
front matter would mean a re-import — the thing the pipeline exists to make
cheap — throwing them away again. A `.yaml` file in a site directory has its
fields merged into `meta`, so the manifest is as queryable as front matter.

**Derivatives come from Commons' thumbnailer, not from a local resize.**
Asking it for a width is less bandwidth than fetching a 7,502-pixel original to
shrink it, and needs no codec here — which **disposes of the `$.resize`
PNG-only problem entirely** for imported images, listed above as a constraint
on the design and not one.

> Corrected in phase 1. This first said the service renders *any* width on
> request. It does not, any more: anything off a fixed list answers `400 Use
> thumbnail sizes listed on https://w.wiki/GHai`, and a page of 1600-pixel
> heroes is a page of broken images. Probed across files of different sizes,
> the list is **120, 250, 330, 500, 960, 1280, 1920, 3840** — so 1920 is a
> hero and 1600 is nothing. The conclusion survives the correction; the widths
> did not.

### What is knowingly left

- **Dominant colours.** Named in the phase and not built: it needs a decoder
  here, which is the one thing the thumbnailer cannot do for us.
- **The download.** `--download` works and was not run for the whole corpus.
  Which widths to keep is a phase 1 question, and phase 1 is what asks it.
- **The date bound.** 500 CE, still a European cutoff. See the open questions.
- **One pre-existing test failure** in `mdy-wikipedia` — *every mdy document in
  the repo survives the round trip* — which fails on a clean checkout too and
  is nothing to do with any of this.

## What phase 1 landed

42 pages, built by `mdy build site`. `site/` is the entry document and its
layouts with the corpus under it; `style-antiquity/` is the look, a package of
its own, imported by path — the `examples/blog` ÷ `examples/blog-style-x` split
copied deliberately, so design iteration never touches the pipeline.

### The design

A **vitrine**. These subjects survive as stone and clay, and museums photograph
stone against near-black under raking light, so the page is dark first and the
photograph is the lit thing on it — which is also what lets an image run
full-bleed without the page having to shout beside it. A light theme exists and
is a cool limestone rather than a cream, because a two-hour read should not
have to be dark.

The two accents are the two pigments on the objects themselves: **Egyptian
blue**, the first synthetic pigment, made around 2500 BC and traded from Egypt
into Mesopotamia — and **red ochre**, used for one thing only, which is time.

Type is the reading and the apparatus, kept apart: **Spectral** for prose and
headlines, **Archivo** — uppercase, tracked, small — for everything that is a
museum's voice rather than the article's: object labels, dates, credits,
navigation.

### What the data already pays for

The point of the conversion shows up on the page before any rewriting happens.

- **The eyebrow over every title** — `bilingual inscription · 196 BC` — is
  Wikidata's `instance-of` and `inception`, not prose.
- **Every image carries its author and licence** under it, because phase 0 went
  and got them.
- **Babylon has a table of who held it**, twelve rows, Neo-Assyrian through
  Rashidun, with Parthia appearing twice because Parthia held Babylon, lost it
  and took it back. Nobody wrote that table. It is `country` with the years
  each statement held for, which is exactly the thing the importer's own plan
  argues is the difference between a record and a wrong one.
- **The archetype is chosen from data**: coordinates mean a place, and a place
  gets that table where an article gets a plain object label.

### Three things running it taught

**Every link in the corpus was pointing at nothing.** `--links wiki` writes
`[[ fort-julien ]]`, which is a relative href to a document that exists for
3.4% of links and not for the other 96.6%. The fix needed information the
converter was computing and throwing away, so `link-titles` — slug to the title
behind it — now goes into the front matter under `--links wiki`, where it is
both needed and small enough to be worth having. With it a layout can send a
link into the fork or out to the Wikipedia article it came from, and neither is
guessed. (It cannot be called `links`: mdy's own parser writes the slugs it
sees to `res.data.links`, and the first spelling silently overwrote them.)

Outbound links are marked, quietly — a rule under the words rather than the
blue of an internal link. They were marked with an arrow first, and at 96.6%
outbound that littered every paragraph; the page's boldness is meant to be
spent on the photographs.

**A map is not a hero.** The first image in an article is whatever came first
in the page, which for a good many is a plan or a timeline. The lead image the
summary endpoint names comes first now, and a diagram sorts behind a
photograph. It does not save every page — Babylon's own lead image really is a
satellite photograph of the modern site — and the pages it does not save are
the argument for phase 2's image plan.

**Wikidata's labels fall back to another language silently.** The Rosetta Stone
is an `instance-of` `[Überrest, bilingual inscription, stele]`, and taking the
first put a German word at the top of the page. Where a property offers several
values the site now prefers one that reads as English. The real fix belongs in
the importer, which asks for labels in the wiki's language and cannot currently
say which ones it did not get.

### Where the images go is still the open question

The importer records an article's images without recording which paragraph each
belongs to, so the page cannot interleave them. Rather than scatter them and
hope, it gathers them into a **plate section** and says why — the way a printed
history gathers its plates, and for exactly the same reason.

That is an honest answer and not a good one, and it is the single clearest
argument for the rewrite schema: `image-plan` is the field that turns this
section into figures where the words are.

### What is knowingly left

- **A search index.** `$.tokenize` is there for it; nothing uses it yet.
- **Era hubs, timelines and maps.** Phase 4, and the corpus is large enough now
  to make them worth building.
- **`--download`.** Still not run: the site points at Commons, which is fine
  for 41 articles and not for a launch.
- **Build time.** 65 seconds for 42 pages, most of it the link-rewriting
  transform over 41 large trees. Fine now, worth watching at 5,000.

## Open questions

- **The corpus boundary.** "Ancient" ends where? A hard date (476, 500, 600)
  is defensible and wrong at the edges — the Sasanians and the Gupta empire
  do not respect a European cutoff. Probably a per-region cutoff, and a
  decision that has to be made in the query rather than argued in prose.
- **The name.** Not chosen. This document says "the fork" throughout.
- **Where the rewrite is stored.** `edited/en/*.mdy` as a sibling vault is
  the assumption above. The alternative is a second document *inside* the
  same file, since an `.mdy` source splits on bare `---` and the importer
  already writes one document per file — which would keep a rewrite and its
  source literally together and make the reader's job trivial, at the cost
  of a re-import having to merge rather than overwrite. Worth trying before
  committing to two trees.
- **JPEG in `$.resize`.** Less pressing than it looked: phase 0 gets its
  derivatives from Commons' thumbnailer, so no imported image needs the native
  at all. It still matters for images the fork adds itself, and for asking for
  a size the pipeline did not predict.
- **How much of stage 3 belongs in `mdy-wikipedia`.** The licence fields
  clearly do. Downloading originals probably does not.
- **Whether the reader in this repository becomes the review tool** for
  stage 5, or stays what it is. It already shows a document beside its
  source and lets a link be edited away; showing a rewrite beside its
  original is the same shape.
