/** Does the search widget actually find things? Typed into a real browser. */
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {join, extname} from 'node:path'

const dist = process.argv[2] ?? 'dist'
const queries = process.argv.slice(3)
const types = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json'}

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0])
  if (path.endsWith('/')) path += 'index.html'
  try {
    const body = await readFile(join(dist, path))
    res.writeHead(200, {'content-type': types[extname(path)] ?? 'application/octet-stream'})
    res.end(body)
  } catch { res.writeHead(404); res.end() }
})

await new Promise((r) => server.listen(4466, r))

const browser = await chromium.launch()
const page = await browser.newPage({viewport: {width: 1440, height: 900}, colorScheme: 'dark'})

await page.goto('http://localhost:4466/', {waitUntil: 'networkidle'})

for (const query of queries) {
  await page.fill('#search-input', '')
  await page.fill('#search-input', query)
  await page.waitForTimeout(900)

  const n = await page.locator('#search-results li').count()
  const first = n ? (await page.locator('#search-results li').first().innerText()).split('\n')[0] : '(none)'

  console.log(`${query.padEnd(18)} ${String(n).padStart(2)} results   first: ${first}`)
}

await page.screenshot({path: process.env.SHOT ?? '/dev/null'})
await browser.close()
server.close()
