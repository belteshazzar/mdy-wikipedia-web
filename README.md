# @mdy-docs/mdy-wikipedia-web

Read Wikipedia as mdy. An article on the right, the MDY it was converted into
on the left, and every link in it another article away.

```sh
npm run dev                              # → http://localhost:4400/
npm run dev -- --port 4500 --vault vault
```

## Getting it to run

It depends on three packages that are not published separately — the converter,
the editor, and mdy itself. All three are vendored as git submodules under
`third-party/`, so nothing is expected to be checked out beside this repository
and it runs from wherever it is cloned:

```sh
git clone --recurse-submodules \
  https://github.com/belteshazzar/mdy-wikipedia-web.git
cd mdy-wikipedia-web

make -C third-party/mdy-docs/third_party/lamassu-js pkg   # needs Emscripten
third-party/mdy-docs/third_party/nisaba-db/wasm/build-wasm.sh

npm install && npm run dev
```

Cloned without `--recurse-submodules`, `git submodule update --init
--recursive` fills `third-party/` in — recursively, because mdy-docs vendors
its own engines the same way.

- `third-party/mdy-wikipedia` — the converter,
  [mdy-wikipedia](https://github.com/belteshazzar/mdy-wikipedia).
- `third-party/mdy-docs` — mdy itself,
  [mdy-docs](https://github.com/mdy-docs/mdy-docs), and the editor with it:
  `@mdy-docs/mdy-site` is `packages/mdy-site` inside that same checkout rather
  than a submodule of its own, which is also what keeps mdy-site's own
  `file:../..` pointing where it means to.

The two build steps are mdy-docs': it runs on two WASM/C engines that are
vendored as source and are not in the repository built. Its README has the
detail. Everything else is an ordinary `npm install`, and every link it makes
lands inside `third-party/`.

## What it is

[`@mdy-docs/mdy-wikipedia`](https://github.com/belteshazzar/mdy-wikipedia)
turns a Wikipedia page into a document. This is the way to look at what it did — and the quickest way
to find out what a conversion decision actually costs, because both halves are
in front of you at once.

- **Source, left.** [`@mdy-docs/mdy-site`](https://github.com/mdy-docs/mdy-docs/tree/main/packages/mdy-site)'s editor, imported
  rather than copied: the same textarea with a painted copy behind it, the same
  MDY colouring, the same stylesheet. Type in it and the article follows — after
  a pause, not after every keystroke, because a converted article is 125,000
  characters and re-reading all of them is not something to do between one
  keypress and the next. Hold a key down and the colouring steps aside too, so
  what is on screen is the textarea's own text; both come back when you stop.
- **Article, right.** Not a preview of the conversion — the document itself,
  parsed in the browser by the same parser mdy-docs itself uses.
- **Data tab.** The front matter: the infobox as a record, the coordinates, the
  outline, the images.
- **Messages, underneath.** What the conversion could not write, and what the
  parser had to say. For most articles this is empty or close to it, which is
  the point.

**Click a link in the article and it asks what to do with it.** Two things are
worth doing with a link, so a click offers both rather than assuming one:

- **Download and show page** reads that article too — from memory if it has been
  read already, from the vault if it is there, and from Wikipedia otherwise. The
  badge beside the title says which of the three it was. Browser back and
  forward work, and the address bar carries the page, so a reading is a link
  somebody else can open.
- **Remove link** decides it should not have been a link. The source loses the
  `[[ … ]]` and keeps the words it said, the article follows the way it follows
  any edit to the source, and the document is saved — to the vault if there is
  one, and to the session if there is not, which the badge then says. This is
  the quickest way to answer the question the reader exists to ask: *should the
  converter have written that?*

A modifier-click still goes straight to the link, and links that are not to a
Wikipedia article — a citation's link to a newspaper — open in a new tab as
they did, since there is no article behind them to read.

**Discard, in the bar, takes a reading back.** Following a link converts a page
and keeps it, which is what makes the second visit instant and the vault worth
having — right up until the link was a wrong turn. Discard deletes that document
from the vault and from the session, and goes back to the one it was reached
from. The history entry goes with it rather than being stepped back over:
stepping back would leave the discarded page one *forward* press away, and
arriving there would fetch and keep it all over again.

## Options

```sh
npm run dev -- --vault vault --open "Ancient Near East" --wikidata
```

| | |
| --- | --- |
| `--port <n>` | default 4400 |
| `--vault <dir>` | keep documents here, and start from what is already in it |
| `--lang <code>` | which wiki (default `en`) |
| `--open <title>` | the page to show first (default Babylon) |
| `--no-images`, `--refs <mode>` | passed to the converter |
| `--keep-pronunciation` | keep how the title is said; taken out by default |
| `--no-wikidata` | skip the Wikidata record; resolved by default |
| `--dist` | serve the built page rather than vite's |

`--vault` points at a directory the way `mdy-wikipedia --out-dir` writes one, so
a vault built from the command line can be read here and a session's reading
adds to it. It is `.gitignore`d: what it holds is a reading, not the app.

One process serves both the API and the page: vite in development, `dist/` when
vite is not installed. Whether *vite* is there is the test rather than whether
`dist/` is, so one `npm run build` does not quietly leave the dev server serving
yesterday's bundle.

## Four decisions worth knowing about

**Links are converted as full URLs**, always, whatever the converter's default
is. It is the only mode that survives the trip: `[[ babylonia ]]` has lost the
title it came from, and `/wiki/babylonia` has been lower cased by mdy's own
link rule (language rule 9), so neither can say which article to fetch when
somebody clicks it. `https://en.wikipedia.org/wiki/Babylonia` can.

**Wikidata comes with every page.** The claims are the part of an article that
is already a record — typed where an infobox is text, dated, and the same in
every language — and the Data tab is where this page shows one, so waiting to be
asked made little sense. It costs two requests on the first read of an article
and nothing on the ones after. `--no-wikidata` skips it.

**The pronunciation is dropped**, unlike the converter's own default. A lead
that opens `Babylon (/ˈbæbɪlɒn/ BAB-il-on) was an ancient city` spends its first
line saying how to pronounce the word rather than anything about the city, and
this page is for looking at what the conversion did to the *article*.
`--keep-pronunciation` puts it back. The brackets and separators that were
punctuation for it go with it, so what is left is a sentence rather than the
hole one was taken out of; the converter's README has the cases.

**Script is off.** A converted article is input this page did not write, and
`mdy({script})` runs it with `new Function` rather than in the lamassu sandbox.
The Data tab reads `file.data.matter` instead, which is the front matter itself
and needs nothing executed to show it. To *run* one of these documents as a
template, use the CLI and a document set, where the sandbox is.

## Test

```sh
npm test
```
