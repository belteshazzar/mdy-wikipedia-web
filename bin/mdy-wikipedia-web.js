#!/usr/bin/env node
/**
 * Read Wikipedia as mdy.
 *
 * One process: an API that converts pages, and the page itself — served by
 * vite in development and out of `dist/` once it has been built. Two commands
 * to look at one document is one command too many.
 */
import {createServer} from 'node:http'
import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {extname, join, resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {createLibrary} from '../src/server.js'

const usage = `mdy-wikipedia-web — read Wikipedia as mdy.

Usage:
  mdy-wikipedia-web [options]

Options:
  --port <n>       (default: 4400)
  --vault <dir>    keep converted documents here, and start from what is
                   already in it. Without one, a session remembers only what
                   it has loaded.
  --lang <code>    which wiki (default: en)
  --open <title>   the page to show first (default: Babylon)
  --no-wikidata    do not resolve Wikidata claims into the front matter. They
                   are resolved by default: the claims are the part of a page
                   that is already a record, and the Data tab is where this
                   page shows one. Two more requests on the first read of an
                   article; nothing on the ones after
  --keep-pronunciation
                   keep how the title is said — the IPA and the respelling
                   that open the lead. Taken out by default here: the reader
                   is for looking at the conversion, and it is a lot of the
                   first line that is about the word rather than the subject
  --no-images      leave the image list out of the front matter
  --refs <mode>    footnotes | data | drop (default: footnotes)
  --dist           serve the built page rather than vite's
  --help
`

const {values} = parseArgs({
  options: {
    port: {type: 'string'},
    vault: {type: 'string'},
    lang: {type: 'string'},
    open: {type: 'string'},
    // Accepted and inert: it asks for what already happens.
    wikidata: {type: 'boolean'},
    'no-wikidata': {type: 'boolean'},
    'keep-pronunciation': {type: 'boolean'},
    'no-images': {type: 'boolean'},
    refs: {type: 'string'},
    dist: {type: 'boolean'},
    help: {type: 'boolean', short: 'h'}
  }
})

if (values.help) {
  process.stdout.write(usage)
  process.exit(0)
}

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist')
const port = Number(values.port ?? 4400)
const opening = values.open ?? 'Babylon'
const library = createLibrary({
  vault: values.vault ? resolve(values.vault) : undefined,
  lang: values.lang,
  convert: {
    wikidata: !values['no-wikidata'],
    images: !values['no-images'],
    refs: values.refs ?? 'footnotes',
    // On by default, unlike the converter's own default. A lead that opens
    // `Babylon (/ˈbæbɪlɒn/ BAB-il-on) was` spends its first line on how to
    // say the word, and this page is for reading what the conversion did to
    // the article.
    dropPronunciation: !values['keep-pronunciation']
  }
})

// Development serves the page through vite, so editing it reloads; without
// vite — an install with no dev dependencies — a built `dist/` is served flat.
// Neither is worth a second process, and asking vite whether it is *there*
// rather than asking the filesystem whether `dist/` is means one `npm run
// build` does not silently leave the dev server serving yesterday's bundle.
const vite = values.dist
  ? undefined
  : await import('vite')
      .then((module) =>
        module.createServer({
          root,
          appType: 'spa',
          // Hung off the chosen port rather than vite's fixed default, so two
          // readers — two wikis, say — can run beside each other. Well clear
          // of it, not next to it: `port + 1` is the port the *next* reader
          // would be started on.
          server: {middlewareMode: true, hmr: {port: hmrPort(port)}}
        })
      )
      .catch(() => undefined)

if (!vite && !existsSync(dist)) {
  process.stderr.write('mdy-wikipedia-web: no vite and no dist/ — run `npm run build` first\n')
  process.exit(1)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')

  try {
    // Before the GET, which would otherwise answer a POST by converting the
    // page all over again and throwing the edit away.
    if (url.pathname === '/api/page' && request.method === 'POST') {
      const body = await readJson(request)

      if (typeof body?.title !== 'string' || typeof body?.source !== 'string') {
        return send(response, 400, {error: 'a title and a source are wanted'})
      }

      return send(response, 200, await library.save(body.title, body.source))
    }

    if (url.pathname === '/api/page' && request.method === 'DELETE') {
      const title = url.searchParams.get('title')

      if (!title) return send(response, 400, {error: 'a title is wanted'})

      return send(response, 200, await library.forget(title))
    }

    if (url.pathname === '/api/page') {
      const page = await library.load(url.searchParams.get('title') ?? opening, {
        refresh: url.searchParams.get('refresh') === '1'
      })

      return send(response, 200, page)
    }

    if (url.pathname === '/api/pages') {
      return send(response, 200, {pages: await library.list(), opening})
    }
  } catch (error) {
    return send(response, 502, {error: error.message})
  }

  if (vite) return vite.middlewares(request, response, () => notFound(response))

  await serveStatic(url.pathname, response)
})

server.listen(port, () => {
  process.stdout.write(
    'mdy-wikipedia-web http://localhost:' + port + '/' +
      (values.vault ? '  (vault: ' + resolve(values.vault) + ')' : '') + '\n'
  )
})

/**
 * @param {number} port
 * @returns {number}
 */
function hmrPort(port) {
  return port < 55000 ? port + 10000 : port - 10000
}

/**
 * A JSON request body.
 *
 * Capped, because the only thing that posts here is the reader posting back a
 * document it already has — an edited article is tens of kilobytes, and
 * anything an order of magnitude past that is not one.
 *
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<object | undefined>}
 */
async function readJson(request) {
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    size += chunk.length

    if (size > 4_000_000) throw new Error('body too large')

    chunks.push(chunk)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {object} body
 */
function send(response, status, body) {
  const value = JSON.stringify(body)

  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(value)
  })
  response.end(value)
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
}

/**
 * @param {string} pathname
 * @param {import('node:http').ServerResponse} response
 */
async function serveStatic(pathname, response) {
  // A single page: anything that is not a file is the app, which reads the
  // page it should show off the query string.
  const wanted = pathname === '/' || !extname(pathname) ? '/index.html' : pathname
  const file = join(dist, wanted)

  if (!file.startsWith(dist)) return notFound(response)

  const body = await readFile(file).catch(() => undefined)

  if (!body) return notFound(response)

  response.writeHead(200, {'content-type': types[extname(file)] ?? 'application/octet-stream'})
  response.end(body)
}

/** @param {import('node:http').ServerResponse} response */
function notFound(response) {
  response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'})
  response.end('Not found\n')
}
