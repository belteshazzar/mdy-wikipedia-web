# pipeline

Phase 0 of [docs/ancient-plan.md](../docs/ancient-plan.md): a corpus of
ancient-history articles, cross-linked into a vault of its own, with the rights
to every image in it named.

Nothing here holds the corpus. It holds what the corpus is made from, which is
the part worth keeping: `site/corpus/` is a build, and these four files plus the
converter rebuild it.

```sh
# 1. which articles           (select.rq → titles.txt; commit the result)
curl -G https://query.wikidata.org/sparql \
  --data-urlencode query@pipeline/select.rq \
  -H 'Accept: text/csv' -H 'User-Agent: … (you@example.com)' \
  | tail -n +2 | cut -d, -f1 > pipeline/titles.txt

# 2. import them, cross-linked
node third-party/mdy-wikipedia/bin/mdy-wikipedia.js \
  --from pipeline/titles.txt --out-dir site/corpus/en --links wiki \
  --categories --lang-links --delay 100 --contact you@example.com

# 3. who made each image, and on what terms
node pipeline/enrich-images.mjs site/corpus            # → site/corpus/images.yaml
node pipeline/enrich-images.mjs site/corpus --download # → static/img/, optional

# and what came of it
node pipeline/check-links.mjs site/corpus/en
node pipeline/check-parse.mjs site/corpus/en
node pipeline/audit-images.mjs
```

Both fetching steps cache under `~/.cache/mdy-wikipedia`, so the second run of
any of this costs nothing and the third is instant.

- **`select.rq`** — the corpus, as a Wikidata query. Why not categories, why
  not the transitive subclass walk, and where the date bound is still an open
  question, are all in the file.
- **`titles.txt`** — what the query returned, one per line, as
  `mdy-wikipedia --from` wants it. Committed, so an import is reproducible
  without the query service being up.
- **`enrich-images.mjs`** — the licence, the author and the derivative sizes
  for every image, into `site/corpus/images.yaml`. The header says why they go
  beside the documents rather than into them.
- **`check-links.mjs`** — how much of the link graph stays inside the corpus,
  and which pages it most wants next. That list is the shortlist for the next
  import.
- **`check-parse.mjs`** — every document parses and renders.
- **`audit-images.mjs`** — the licences, and anything still unattributed.

## The queue

Step 1 above answers "which articles" once and by hand. The queue answers it
standing: `seed.mjs` asks Wikidata for every ancient city it can find, sorts
the answer with the cuts in `cuts.mjs`, and writes the lot — kept, cut and
unsortable — into `queue.yaml`. `queue.mjs` reads that back against the disk
and says what to import next.

```sh
node pipeline/seed.mjs                 # → pipeline/queue.yaml
node pipeline/seed.mjs --dry           # what it would say, without writing
node pipeline/queue.mjs                # what state the queue is in
node pipeline/queue.mjs unsorted       # the ones only a person can sort

# and round again, ten at a time
node pipeline/queue.mjs next 10 --wanted > pipeline/next.txt
node third-party/mdy-wikipedia/bin/mdy-wikipedia.js \
  --from pipeline/next.txt --out-dir site/corpus/en --links wiki \
  --categories --lang-links --delay 100 --contact you@example.com
node pipeline/enrich-images.mjs site/corpus
node pipeline/rewrite.mjs --emit --body $(node pipeline/queue.mjs pending)
```

`next` prints titles and `pending` prints slugs, which is the seam rather than
an inconsistency: the importer is given a Wikipedia title, and everything
downstream is addressed by the file it wrote. `pending` is also the honest
answer to "what is left" after an import, because the ten titles just fetched
are no longer waiting — they are imported and unwritten, which is a different
question and the one the rewriting pass asks.

**No progress is stored in `queue.yaml`.** `site/corpus/en/ur.mdy` is the fact
that Ur was imported and `site/edited/en/ur.mdy` the fact that it was
rewritten, so state is a query over two directories rather than a field
somebody has to remember to update — the same reasoning as `status.mjs`. The
only thing in the file a person writes is `rejected`, and a re-seed keeps it.

- **`cuts.mjs`** — which places are cities, which are not, and which nobody can
  tell. Three cuts and a three-valued answer, all argued in the file: the
  interesting one is that a place with no settlement class and no monument
  class is reported as **unsorted** rather than cut, because cutting on that
  absence costs the corpus Megiddo, Qumran, Skara Brae, Jarmo and Mehrgarh. 76
  of 395 land there and they are a morning's work for a person.
- **`seed.mjs`** — the query, the cuts, and the dedupe against what is already
  imported. A place already in the corpus is never cut by rule: somebody chose
  it. What the cuts *would* have said about it is reported anyway, under
  `held against the cuts`, because it is the only measure of how often they are
  wrong. Three of twenty-four, currently — Alexandria and Tyre are living
  cities and Carchemish is unclassified.
- **`queue.mjs`** — the state of the queue, and `next N` as bare titles for
  `--from`. Two orders that disagree usefully: sitelinks is how much the world
  cares, `--wanted` is how many documents here already link to it and miss.
  Constantinople leads the first and the corpus has never asked for it; Ancient
  Corinth and Der lead the second at six documents each.

## The rewriting pass

Phase 2. `docs/house-style.md` is the voice and the rules; `document.mjs` holds
what is asked and what is done with the answer, so both transports below go
through the same prompt and the same document surgery.

```sh
# with an API key in the environment
node pipeline/rewrite.mjs babylon thoth          # → site/edited/en/*.mdy
node pipeline/verify.mjs --all                   # → verdicts, back into them

# without one: emit the request, answer it elsewhere, take the answer back
node pipeline/rewrite.mjs --emit babylon         # → pipeline/requests/babylon.md
node pipeline/rewrite.mjs --apply babylon pipeline/answers/babylon.json
node pipeline/verify.mjs --emit babylon          # → pipeline/checks/babylon.md
node pipeline/verify.mjs --apply babylon pipeline/reports/babylon.json
```

The emitted request is the request the driver would have sent, byte for byte,
so answering it in a console or a subagent exercises the prompt rather than
approximating it.

Two tiers. `--body` writes the lead, the sections, the key facts and the image
plan and leaves out the hook, standfirst, pull quotes, timeline and glossary —
which is the opposite way round from the tiering this plan first proposed, and
the reason is in [what phase 2 landed](../docs/ancient-plan.md#what-phase-2-landed):
those five fields are a twentieth of the words and seven times more likely per
word to say something the article does not. The cheap tier drops the dangerous
fields, not the safe ones.

```sh
node pipeline/rewrite.mjs --emit --body akkadian-empire
node pipeline/status.mjs                       # what state the corpus is in
node pipeline/status.mjs --stale               # slugs whose source has moved
node pipeline/findings.mjs                     # where the verifier's findings are
```

`status.mjs` is the query the phasing asks for: a rewrite names the revision it
was made from, so re-importing the corpus and then asking which rewrites no
longer match is a question with an answer rather than something to remember.

`site/edited/` is committed — a rewrite is not reproducible and re-running it
would not give the same words back. `site/corpus/` still is not.

Each edited document names the revision it was rewritten from, so a re-import
turns "which rewrites are stale" into a query rather than a memory.

## The site

`site/` is the site root — the entry document, the layouts, and the corpus
under it, since a script-defined site is one directory walked whole.
`style-antiquity/` is the look, a package of its own that `site/main.mdy`
imports by path; swapping that one line changes the site's appearance and
nothing else.

```sh
node third-party/mdy-docs/bin/mdy.js build site --out dist
npm run serve                                  # → http://localhost:4500/
npm run serve -- dist 4501                     # somewhere else

node third-party/mdy-docs/bin/mdy.js dev site  # watch + live reload

node pipeline/shot.mjs dist "/=out.png" "/babylon/=b.png=1500"
SCHEME=dark node pipeline/shot.mjs dist "/=dark.png"
```

`npm run serve` exists because the pages use absolute paths, so opening
`dist/index.html` over `file://` resolves `/style.css` and `/babylon/` against
the filesystem root and gives an unstyled page with no search. mdy's own `dev`
server is the one to use when changing layouts — it watches and live-reloads —
but it does a full build first, which is twelve minutes at this corpus size.
`serve.mjs` starts instantly and `shot.mjs` uses the same implementation, so
what you read and what gets photographed are served identically.

`shot.mjs` serves a built site and photographs it — whole pages, a scroll
offset, or either theme. A layout is not finished until it has been looked at.

### Publishing

`.github/workflows/pages.yml` builds the site on every push to `main` and
publishes it to GitHub Pages. It is not `npm run build`: mdy-docs runs on two
WASM engines vendored as C source and gitignored in their own repositories, so
the workflow compiles lamassu and nisaba with emscripten before node can run
`mdy build` at all — and caches both on the mdy-docs commit that produced them,
because that is four minutes in front of a fifteen-second build. Nothing is
fetched: the corpus and the rewrites are committed, and every image is
hot-linked to Commons.

Project Pages serve at `/<repo>/` and every URL this site writes is absolute —
`/style.css`, `/babylon/`, the search index's `fetch` — so the site is **built
for its subpath** rather than moved into one. `base` in `site/build.yaml` is
that path; the workflow sets it from the repository name before it builds, and
it is committed empty so a local build stays a root build and `npm run serve`
is unaffected. Everything downstream follows from it: a page's `url` is the one
place a slug becomes a path, so the timeline, the glossary, the places chart
and the search index inherit the base without knowing it exists. The look takes
it too — `style-antiquity` reads `req.site.base` for the wordmark, the nav and
the two static assets, and `search.js`, which cannot be templated, is handed it
as `data-base` on its own script tag.
