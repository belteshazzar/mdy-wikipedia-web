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
for the hook. ✅ — see [what phase 2 landed](#what-phase-2-landed), which
answers it the other way round.

**Phase 3 — scale, by tier.** Pillar, body, long tail; verification on
everything; provenance per document. Exit: the corpus, complete, and a query
that lists every stale rewrite. ✅ — see
[what phase 3 landed](#what-phase-3-landed).

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

### Done: 41 rewritten, 41 verified

Every article in the corpus is rewritten and every rewrite has a verdict.

| | articles | blocked | findings each |
| --- | --- | --- | --- |
| Pillar, anchored | 18 | **1** (6%) | 2.0 |
| Pillar, not anchored — phase 2's first run | 7 | **4** (57%) | 3.6 |
| Body tier — the five risky fields absent by design | 16 | 1 (6%) | 1.4 |

Corpus-wide: **6 blocked, 32 minor-only, 3 clean.** 84 findings — 56
`unsupported`, 21 `dropped-hedge`, 4 `lost-citation`, 3 `altered-value`.

The rate the phase set out to move:

| | words | findings | per 1,000 |
| --- | --- | --- | --- |
| Rewritten prose | 273,186 | 45 | **0.16** |
| Short generated fields | 32,196 | 35 | **1.09** |

Both are about a third of phase 2's (0.51 and 3.53). The *ratio* barely moved
— short fields are still about seven times more dangerous per word — which is
the honest reading: anchoring lowered the error rate, it did not change where
the errors live.

Three caveats on the 57% against 6%. The seven unanchored are phase 2's own
first run, so some of the gap is everything else that improved since. The
controlled comparison is the three articles re-run with anchoring as the only
change — Duat, Thoth and Nun went from two blocked to none. And 41 articles
graded by a model is evidence, not proof; nobody has read any of it.

### Where it had stopped, and how it resumed

**38 of 41 rewritten, and the session's model quota ran out.** Four pillar
articles were in flight when the account hit its limit: `empire` had already
written a complete answer and was salvaged, `assyria` had written a truncated
one and was discarded, and `neo-assyrian-empire` and
`ancient-egyptian-religion` had written nothing. Their requests are emitted and
waiting; `node pipeline/rewrite.mjs --apply` finishes each the moment an answer
exists.

**The verification pass did not run on 28 of the 38.** Only the ten from phase
2 carry a verdict, three of those re-checked after anchoring. Every other
rewrite is `unverified`, which `pipeline/status.mjs` says plainly. Phase 3's
exit asked for verification on everything and does not have it.

What *is* checked on all 38 is what can be checked without a model: every
document parses and renders, every planned image resolves to a licensed file or
is named as not resolving, every planned section exists, and every footnote
reference is counted against the source — **76 lost of 3,580, 2.1%**, all of
them on figure captions.

### The caption citation gap, now with a number

A footnote on a figure caption has nowhere to go: a caption becomes an
`image-plan` caption, which is plain text. That is the whole of the 2.1%.

Two rewrites found the same workaround unprompted — History of the Assyrians
and Macedonia both folded a cited caption's content into the prose so the
reference survived, and dropped uncited ones. The fix is a `cite` field on
image-plan entries, and it is deliberately **not** added here: every one of the
41 requests was emitted before the gap had a number, so nothing in this corpus
could exercise it, and shipping an untested field to a schema this one depends
on is worse than recording the evidence.

### `--drop-pronunciation` removes more than it says

The flag's own help says it takes out "the IPA and the respelling that open the
lead". The rule behind it matches `class="IPA"` anywhere in the document, so on
a language article it guts the phonology:

> The diphthong οι fronted to , merging with υ.
> The word is pronounced , , or in US English and in UK English

Koine Greek reported it in full; Thoth had already reported the symptom. Both
rewrites handled it correctly — dropped the sentences that were only empty
brackets, reworded the bullets pointing at absent symbols, and said so.

Not fixed, and deliberately not re-imported to avoid: re-importing changes
every source revision and would mark all 38 rewrites stale at once. That is
exactly the situation `status.mjs` exists to manage and not one to walk into
mid-phase. It goes to phase 4 with the re-import, where the fix is positional —
a pronunciation rule that only fires before the first heading.

### What the verifiers found, beyond the counts

**`key-facts` is the field that should have been anchored and was not.** Five
articles lost a hedge there and nowhere else: Book of the Dead states a price
the source attributes to "one source"; Artapanus says the text survives as
"quotation in Clement and Eusebius" where the source's own cited scholars say
only summaries survive; Gutian rule drops the `-mc` suffix that marks a
middle-chronology date as one of two competing ones. It is short, compressed
and unanchored — exactly the profile of the fields that were anchored. That is
phase 3's clearest single recommendation.

**Both body-tier blocking-class errors are in leads.** Isfet's "the counter to
Maat, which was order — and unlike order it had no physical form" asserts that
Ma'at *did* have a physical form, which the source never says; Lagash's lead
conflates the city with the three-city state, twice, in opposite directions.
Body tier drops the five riskiest fields but the lead is still the
highest-compression prose on the page.

**Merging two sentences is where citations go.** All four `lost-citation`
findings came from a merge — Macedonia's `^207`, Lagash's `^41`, and two more.
The house style tells the pass to carry both references when it merges; four
times it did not.

**Added connective sentences are the commonest failure that is not a
compression.** "The kingdom he inherited was losing ground on both sides of
its own borders" — except the losses it summarises are dated inside Ptolemy
V's own reign. A sentence written to smooth a transition, quietly asserting a
chronology.

### What the rules bought

Worth recording, because they held under 273,000 words:

- **Copy the hard values.** Old Assyrian carried "98 by 112 meters (321.5 by
  367.5 meters)" verbatim — a unit error in Wikipedia — rather than convert
  it. Artapanus normalised a one-off "Artanpanus" against ~35 correct
  instances in the same document. Both were put to a verifier and both were
  judged right: fix a typo the source corrects elsewhere, never fix a number.
- **Closed book.** History of the Assyrians' verifier ran a vocabulary diff
  over a 1,873-line rewrite: the only words not in the source were *date,
  make, obligations, outlasted, partaking, regard, resulting, staying*. No new
  named entity anywhere. Empire — the corpus's least ancient article, where
  outside knowledge would leak most easily — came back with every retained
  sentence verbatim identical.
- **Koine Greek is the hardest case and it held.** Its source is damaged: every
  IPA value was stripped by `--drop-pronunciation` before the rewriter saw it.
  Given visible holes in a subject the model certainly knows, it dropped the
  sentences that were only empty brackets and reworded the bullets pointing at
  absent symbols, and invented no phonetic value.

### What is knowingly left

- **Nobody has read any of it.** `reviewed: false` on all 41. Six are blocked
  and unpublishable; the other 35 are a model's word that a model's work is
  sound.
- **A search index.** `$.tokenize` is there for it; nothing uses it yet.
- **Era hubs, timelines and maps.** Phase 4, and the corpus is large enough now
  to make them worth building.
- **`--download`.** Still not run: the site points at Commons, which is fine
  for 41 articles and not for a launch.
- **Build time.** 65 seconds for 42 pages, most of it the link-rewriting
  transform over 41 large trees. Fine now, worth watching at 5,000.

## What phase 2 landed

Ten articles rewritten and verified: Hanging Gardens, Rosetta Stone, Gutians,
Thoth, Pella, Duat, Nile Delta, Tigris, Nun, Ptolemaic synodal decrees. The
prose, the fields, the verdicts and what each pass could not do are in
`site/edited/en/`, and `/compare/<slug>/` puts each rewrite beside its import.

### The answer, and it is not the one this plan expected

This section predicted "a real possibility that the answer is no for the body
and yes for the hook". It is the other way round, and the numbers are not
close.

| | words | findings | per 1,000 words |
| --- | --- | --- | --- |
| Rewritten prose (lead + sections) | 23,606 | 12 | **0.51** |
| The short generated fields | 5,949 | 21 | **3.53** |

The prose is faithful. **The compression is where the fabrication is** — seven
times denser, in a twentieth of the words. And the mechanical rules held
completely: across ten articles and several hundred footnote markers there
were **zero lost citations** — Rosetta Stone alone carries 122 in the source
and 122 in the rewrite, in the same order — and **one** altered value in
29,000 words.

Of 34 findings, 20 were `unsupported` and 13 `dropped-hedge`. Only one was a
changed number. That is a single failure mode wearing two names, and it has an
obvious cause: **the shortest arresting version of a hedged claim is the
unhedged one.** A hook has to fit above a photograph. "Knowledge of it derives
principally from funerary texts, among many other sources" does not fit;
"known only from funerary texts" does, and is wrong.

The clearest case is the Tigris, where the best sentence in the rewrite is the
invented one:

> …so the two rivers that define Mesopotamia begin within a morning's walk of
> each other.

The source says the Tigris rises about 30 km south of the Euphrates *valley*.
It never locates the Euphrates' source and never characterises the gap. The
sentence is a pleasure to read and a fabrication, and no rule about dates or
citations would have caught it.

**Six of the ten were blocked.** That is the verifier working rather than the
pipeline failing — every blocking finding was real on inspection, and none was
a style complaint, which the checker was explicitly told not to report.

### So the review that matters is small

Nothing publishes unreviewed. But the review is not "read the article": it is
read the hook, the standfirst, the timeline and the glossary, which is about
600 words per article and holds 21 of the 34 findings. Three practical
consequences for phase 3:

- **Verify the short fields separately and harder** than the prose, since they
  fail seven times as often and take a twentieth of the reading.
- **Anchor them.** A hook that must quote or cite the sentence it compresses
  cannot drop the hedge in that sentence without the loss being visible.
- **Tier by field, not only by article.** A body-tier article that gets a hook
  and a standfirst and nothing else is getting exactly the two fields with the
  worst error rate. That is the wrong economy, and the tiering table above
  needs revisiting before phase 3 scales it.

### The schema was missing the lead, and the documents said so

`left-out` is a field asking each pass what it could not do. **Eight of the ten
used it to report the same structural hole**: the prose above the first heading
had nowhere to go, because `sections` only covers headed sections and the
outline in the front matter does not list the lead.

They each worked around it differently — pushing lead material into the first
section, into key facts, into the standfirst — so before the fix the ten were
inconsistent in exactly the part a reader sees first. Thoth's pass named the
real cost: material that survived "only in the hook, standfirst, timeline and
glossary, which cannot carry footnote references" is material that lost its
citations. Hanging Gardens had seven footnotes belonging to lead sentences
with nowhere to ride.

The schema now has a `lead` field and every article was re-run through it. The
finding worth keeping is not the bug: it is that **a field asking what could
not be done is the cheapest instrumentation in the pipeline**, and it caught a
design error in the first article of the first run.

### What the ten reported about the corpus

The same field turned up things no test would have:

- **The Tigris is three different lengths** in one document — 1,900 km in the
  infobox, 1,850 km in Wikidata, 1,750 km in the prose. The rewrite copied each
  where it stood and declined to reconcile them, which is right.
- **585 images are in the bodies against 536 in the front matter**, so the
  image plan cannot name the ones the plan most wants. Gutians, Tigris and Nun
  each hit it.
- **Pella's lead and its History section link the same names to different
  targets** — `archelaus-i-of-macedon` against `archelaus-of-macedon` — carried
  across unchanged rather than quietly reconciled.
- Nun's source has **broken figure markup**; Ptolemaic's has a stray bracket
  and a misspelling, repaired without changing a date or a name; Thoth's
  "Name" section has **empty asterisks where the IPA should be**.

### What is knowingly left

- **The image plan is produced and not consumed.** Every rewrite names a hero,
  a role and a rewritten caption per image, and the site still lays out a
  rewritten page from the original's own `<img>` tags — which the rewritten
  body does not carry, so a rewritten page currently shows its hero and no
  figures at all. That is a regression against an imported page and the first
  thing phase 3 should fix.
- **Nothing has been read by a person.** `reviewed: false` in every document.
  The verdicts are a model's, and the point of blocking six of ten is that
  somebody now looks at them.
- **The transport was not the API.** The requests were emitted by
  `rewrite.mjs --emit` and answered by Claude Code subagents, byte for byte the
  prompt the driver sends; only the HTTPS call was missing. The API path is
  written and untested.
- **Ten parallel agents sharing one scratchpad overwrote each other's working
  files.** Harmless here, worth knowing before phase 3 runs hundreds.

## What phase 3 landed

Not finished. Recorded as it goes, because the two changes below were made
*because* of what phase 2 measured, and the evidence for them is worth keeping
whether or not the scale-out completes.

### Anchoring works

Phase 2 found the short fields seven times more likely per word to say
something the article does not, and blamed compression rather than
carelessness. The fix: the hook, the standfirst and every timeline and
glossary entry must quote the passage they compress, verbatim, written quote
first. The quotes stay in the document as `anchors`.

Three articles were re-run through it — the same house style, the same
verifier prompt, the anchoring the only change:

| | before | after |
| --- | --- | --- |
| Duat | blocked, 3 findings, 1 blocking | minor-only, 3 findings, **0 blocking** |
| Thoth | blocked, 2 findings, 1 blocking | minor-only, 1 finding, **0 blocking** |
| Nun | minor-only, 4 findings | minor-only, **1 finding** |
| | 9 findings, 2 blocking | **5 findings, 0 blocking** |

Both blocking findings went, and the two that had been the sharpest
illustrations of the failure went with them. Duat's standfirst said the realm
was "known only from funerary texts" where the source says "principally …
among many other sources"; it now says "generally known best as". Thoth's hook
made scribes the actor burying millions of mummified ibises where the source
names no actor; it is now passive, and its anchor quotes the source sentence
word for word.

Three articles is not a study, and re-running any article produces different
prose whether or not anything changed, so some of that is variance. But the
direction is the same in all three, and the mechanism is visible in the text:
a hook sitting one line from the sentence it compresses is a hook whose
overreach a reviewer can see in ten seconds.

### The tiering is inverted, and the cheap tier is now the safe one

The table above gave a body-tier article a hook, a standfirst and an image
plan and left the prose imported — which spends the cheap tier entirely on the
fields that fail most, with no rewritten prose to anchor them. `--body` now
writes the lead, the sections, the key facts and the image plan and **none of
the five risky fields**, so a body-tier page has nothing in it that phase 2
identified as dangerous. The page uses the article's own description where a
standfirst would go.

Ranking is a query rather than a guess: `pipeline/tiers.mjs` counts
`langlinks`, which the import already records, so the sitelink count needs no
second request. Alexander the Great at 219 languages down to Post-imperial
Assyria at 3; the cut at 60 gives 20 pillar and 21 body. There is no long tail
in a corpus this size — 41 articles about the ancient Near East are all of them
somebody's pillar.

### The image plan is consumed

Phase 2 left it produced and ignored, which made a rewritten page *worse* than
the import it replaced: its body carries no `<img>` of its own, so it showed a
hero and nothing else. Each planned picture now goes in front of the heading of
its section, at the size its role asks for, with the rewrite's caption and the
manifest's credit.

Two articles could not place everything, and the cause was upstream: the rights
enrichment had only ever read the front matter's `images` list, and the bodies
carry 585 distinct pictures against that list's 536. It reads both now — 527
licensed files against 476 — and the layout resolves a planned file from the
manifest rather than requiring a front-matter entry.

What is left is transcription drift, and it is noisy rather than silent now:
`--apply` checks every planned file against the manifest and every planned
section against the outline, because both are checkable without a model. Two
files in ten articles fail it — `Akerblad.jpg` for `Åkerblad.jpg`, and a name
taken from Nun's broken figure markup.

### Redirect fragmentation, reported by the documents again

Three rewrites said, unprompted, that one subject is reachable under two slugs:
`set-deity` / `set-mythology` / `set-god`, `shu-egyptian-god` / `shu-god`,
`aegae-macedonia` / `aegae-macedon`. `--links wiki` slugifies each title as
written and Wikipedia reaches one article by many.

`pipeline/variants.mjs` was written to count it and cannot, which is the useful
part: from inside the corpus, `Set (deity)` against `Set (mythology)` — one
subject, two names — looks exactly like `Macedonia (ancient kingdom)` against
`Macedonia (Roman province)` — two subjects, one name. It lists candidates and
declines to total them. The fix is redirect resolution in the importer, the
same gap that wrote `akkadian-empire` and `akkadian-period` as two documents in
phase 0, and it belongs in a phase of its own.

### Two bugs the phase found in itself

**`--apply` left a verdict behind that no longer described anything.** A
re-applied rewrite is new text, so the old verdict is void — the document loses
it by being rewritten, and the report beside it now goes too.

**The cheap tier broke `compose` on its first article**, which assumed every
answer has a hook. Short fields go through one accessor that survives all three
shapes: absent, a bare string, and the `{text, from}` pair.

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
