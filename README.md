# @mdy-docs/mdy-wikipedia-web

Read Wikipedia as mdy. An article on the right, the MDY it was converted into
on the left, and every link in it another article away.

```sh
npm run dev                              # → http://localhost:4400/
npm run dev -- --port 4500 --vault vault
```

## Getting it to run

It depends on three packages that live in the
[mdy-docs](https://github.com/mdy-docs/mdy-docs) monorepo and are not published
separately — the converter, the editor, and mdy itself — by relative `file:`
path. So it expects to sit where it was extracted from:

```sh
git clone --recurse-submodules https://github.com/mdy-docs/mdy-docs.git
git clone https://github.com/belteshazzar/mdy-wikipedia-web.git \
  mdy-docs/packages/mdy-wikipedia-web

cd mdy-docs && npm install          # see its README: the engines need building
cd packages/mdy-wikipedia-web && npm install && npm run dev
```

Anywhere else, `npm install` will not find `file:../mdy-wikipedia`,
`file:../mdy-site` or `file:../..`. Point them somewhere real and it will run
from anywhere.

## What it is

[`@mdy-docs/mdy-wikipedia`](https://github.com/mdy-docs/mdy-docs/tree/main/packages/mdy-wikipedia)
turns a Wikipedia page into a document. This is the way to look at what it did — and the quickest way
to find out what a conversion decision actually costs, because both halves are
in front of you at once.

- **Source, left.** [`@mdy-docs/mdy-site`](https://github.com/mdy-docs/mdy-docs/tree/main/packages/mdy-site)'s editor, imported
  rather than copied: the same textarea with a painted copy behind it, the same
  MDY colouring, the same stylesheet. Type in it and the article follows.
- **Article, right.** Not a preview of the conversion — the document itself,
  parsed in the browser by the same parser mdy-docs itself uses.
- **Data tab.** The front matter: the infobox as a record, the coordinates, the
  outline, the images.
- **Messages, underneath.** What the conversion could not write, and what the
  parser had to say. For most articles this is empty or close to it, which is
  the point.

**Click a link in the article and it reads that article too** — from memory if
it has been read already, from the vault if it is there, and from Wikipedia
otherwise. The badge beside the title says which of the three it was. Browser
back and forward work, and the address bar carries the page, so a reading is a
link somebody else can open.

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
| `--wikidata`, `--no-images`, `--refs <mode>` | passed to the converter |
| `--dist` | serve the built page rather than vite's |

`--vault` points at a directory the way `mdy-wikipedia --out-dir` writes one, so
a vault built from the command line can be read here and a session's reading
adds to it. It is `.gitignore`d: what it holds is a reading, not the app.

One process serves both the API and the page: vite in development, `dist/` when
vite is not installed. Whether *vite* is there is the test rather than whether
`dist/` is, so one `npm run build` does not quietly leave the dev server serving
yesterday's bundle.

## Two decisions worth knowing about

**Links are converted as full URLs**, always, whatever the converter's default
is. It is the only mode that survives the trip: `[[ babylonia ]]` has lost the
title it came from, and `/wiki/babylonia` has been lower cased by mdy's own
link rule (language rule 9), so neither can say which article to fetch when
somebody clicks it. `https://en.wikipedia.org/wiki/Babylonia` can.

**Script is off.** A converted article is input this page did not write, and
`mdy({script})` runs it with `new Function` rather than in the lamassu sandbox.
The Data tab reads `file.data.matter` instead, which is the front matter itself
and needs nothing executed to show it. To *run* one of these documents as a
template, use the CLI and a document set, where the sandbox is.

## Test

```sh
npm test
```
