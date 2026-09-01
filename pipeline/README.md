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

## The site

`site/` is the site root — the entry document, the layouts, and the corpus
under it, since a script-defined site is one directory walked whole.
`style-antiquity/` is the look, a package of its own that `site/main.mdy`
imports by path; swapping that one line changes the site's appearance and
nothing else.

```sh
node third-party/mdy-docs/bin/mdy.js build site --out dist
node third-party/mdy-docs/bin/mdy.js dev site        # watch + live reload

node pipeline/shot.mjs dist "/=out.png" "/babylon/=b.png=1500"
SCHEME=dark node pipeline/shot.mjs dist "/=dark.png"
```

`shot.mjs` serves a built site and photographs it — whole pages, a scroll
offset, or either theme. A layout is not finished until it has been looked at.
