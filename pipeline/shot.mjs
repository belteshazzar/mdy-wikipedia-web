/** Look at a built page, at a real width, the way a reader would. */
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {join, extname} from 'node:path'

const dist = process.argv[2]
const pages = process.argv.slice(3)
const types = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'}

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0])
  if (path.endsWith('/')) path += 'index.html'
  try {
    const body = await readFile(join(dist, path))
    res.writeHead(200, {'content-type': types[extname(path)] ?? 'application/octet-stream'})
    res.end(body)
  } catch { res.writeHead(404); res.end('not found') }
})
await new Promise((r) => server.listen(4455, r))

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: {width: 1440, height: 1000},
  deviceScaleFactor: 1,
  colorScheme: process.env.SCHEME === 'dark' ? 'dark' : 'light'
})

for (const spec of pages) {
  const [url, name, mode] = spec.split('=')
  await page.goto('http://localhost:4455' + url, {waitUntil: 'networkidle', timeout: 60000})
  await page.waitForTimeout(600)
  if (mode && mode !== 'full') {
    // A scroll offset, so a tall page can be looked at in readable pieces.
    await page.evaluate((y) => window.scrollTo(0, y), Number(mode))
    await page.waitForTimeout(500)
  }
  await page.screenshot({path: name, fullPage: mode === 'full'})
  console.log('shot', name)
}

await browser.close()
server.close()
