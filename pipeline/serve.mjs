/**
 * Serve a built site.
 *
 * Needed because the pages use absolute paths — `/style.css`, `/babylon/`,
 * `/search-index.json` — so opening `dist/index.html` over `file://` resolves
 * every one of them against the filesystem root: an unstyled page with no
 * search and no working links.
 *
 * mdy has its own dev server with watch and live reload, and that is the one
 * to use when changing layouts. This is for reading the site, and starts
 * instantly rather than after a full rebuild.
 *
 *   node pipeline/serve.mjs [dir] [port]      # or: npm run serve
 */

import {createServer} from 'node:http'
import {readFile, stat} from 'node:fs/promises'
import {extname, join, normalize} from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8'
}

/**
 * A static file server over `root`.
 *
 * @param {string} root
 * @returns {import('node:http').Server}
 */
export function createStatic(root) {
  return createServer(async (request, response) => {
    // Everything after the last `..` is resolved away, so a request cannot
    // climb out of the directory being served.
    const asked = decodeURIComponent((request.url ?? '/').split('?')[0])
    const path = normalize(asked).replace(/^(\.\.[/\\])+/, '')

    for (const candidate of [
      path.endsWith('/') ? join(path, 'index.html') : path,
      // `/babylon` means `/babylon/index.html`, which is how every article on
      // this site is addressed.
      extname(path) ? undefined : join(path, 'index.html')
    ]) {
      if (!candidate) continue

      const file = join(root, candidate)

      try {
        const info = await stat(file)

        if (!info.isFile()) continue

        response.writeHead(200, {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'content-length': info.size,
          'cache-control': 'no-cache'
        })
        response.end(await readFile(file))
        return
      } catch {
        // try the next candidate
      }
    }

    response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'})
    response.end(`not found: ${asked}\n`)
  })
}

// Run directly, rather than imported by the screenshot tool.
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? 'dist'
  const port = Number(process.argv[3] ?? 4500)

  try {
    await stat(join(root, 'index.html'))
  } catch {
    console.error(`nothing built at ${root}/index.html — run the build first:`)
    console.error(`  node third-party/mdy-docs/bin/mdy.js build site --out ${root}`)
    process.exit(1)
  }

  const server = createStatic(root)

  // A port already in use is the commonest way this fails and the stack trace
  // for it says nothing useful.
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`port ${port} is already in use — try another:`)
      console.error(`  npm run serve -- ${root} ${port + 1}`)
      process.exit(1)
    }

    throw error
  })

  server.listen(port, () => {
    console.log(`${root} → http://localhost:${port}/`)
    console.log(`  /timeline/  /glossary/  /quotations/  /places/`)
  })
}
