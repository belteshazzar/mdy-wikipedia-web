/**
 * What the importer could not know about an image: who made it, and on what
 * terms.
 *
 * `mdy-wikipedia` writes each image as `file`, `src`, `width`, `height`,
 * `caption`. That is the right record for an encyclopedia showing a picture at
 * 250 px in a sidebar, and it is not enough to show one full-bleed on a fork
 * of your own: nothing in it says who took the photograph, under what licence,
 * or whether the file is free at all. Commons knows all three, so this asks.
 *
 * Three decisions worth naming.
 *
 * **The answers go beside the documents, not into them.** A manifest keyed by
 * file name, which the site joins against `images[].file`. Writing licences
 * back into each document's front matter would mean a re-import — the thing
 * the whole pipeline is built to make cheap — silently throwing them away
 * again. A `.yaml` file in a site directory has its fields merged straight
 * into `meta`, so a manifest is as queryable as front matter would have been.
 *
 * **Derivatives are Commons' thumbnails, not local resizes.** The thumbnail
 * service renders any width on request, which is what the `500px-` in an
 * imported `src` already is. Asking it for the sizes a layout wants is less
 * bandwidth than fetching a 7502-pixel original to shrink it, needs no image
 * codec here at all, and sidesteps `$.resize` handling PNG only — which would
 * otherwise stop at the first JPEG, and nearly every photograph is one.
 *
 * **A file that is not on Commons is assumed non-free.** Non-free files are
 * uploaded to the local wiki precisely because Commons will not take them, and
 * their fair-use rationale is Wikipedia's rather than ours. They are dropped
 * with a reason, not silently.
 *
 *   node pipeline/enrich-images.mjs [corpus] [--download]
 */

import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {dirname, join} from 'node:path'
import YAML from 'yaml'

const root = process.argv.find((a) => !a.startsWith('--') && a.includes('corpus')) ?? 'corpus'
const download = process.argv.includes('--download')
const lang = 'en'
const cacheDir = join(process.env.HOME ?? '.', '.cache', 'mdy-wikipedia', 'commons')
const agent =
  'mdy-wikipedia-web/0.1 (https://github.com/belteshazzar/mdy-wikipedia-web; gbelteshazzar@gmail.com)'

// The widths a page might ask for: a thumbnail in a list, an inline figure, a
// hero on a laptop, a hero on a display that costs more than the laptop.
//
// They are not free choices. The thumbnail service used to render any width
// asked of it and now answers `400 Use thumbnail sizes listed on
// https://w.wiki/GHai` for anything off a fixed list, which — probed across
// files of different sizes, since the documentation is a wiki page and the
// behaviour is the thing that has to be true — is exactly:
//
//   120  250  330  500  960  1280  1920  3840
//
// So 1600 is a broken image and 1920 is a hero. Anything not on this list will
// silently produce a page of broken pictures, which is how this was found.
const widths = [330, 500, 960, 1280, 1920]

/** Wikipedia's own words for "you may not reuse this". */
const unfree = /non-?free|fair use|with permission|all rights reserved/i

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The API answers in normalised titles — `File:Bronze head of an Akkadian
// ruler.jpg` where the front matter says `Bronze_head_of_an_Akkadian_ruler.jpg`
// — so both sides are keyed the same way or nothing matches and every file on
// Commons reports as missing.
const key = (file) => file.replace(/_/g, ' ')

/** A cached GET. The second run of an import costs nothing; so does this. */
async function get(url) {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 32) + '.json'
  const path = join(cacheDir, key)
  const cached = await readFile(path, 'utf8').catch(() => undefined)

  if (cached) return JSON.parse(cached)

  const response = await fetch(url, {headers: {'user-agent': agent}})

  if (!response.ok) throw new Error(response.status + ' ' + url)

  const body = await response.json()

  await mkdir(cacheDir, {recursive: true})
  await writeFile(path, JSON.stringify(body))
  await sleep(100)

  return body
}

/** extmetadata values are HTML — an `Artist` is usually a link. */
function text(value) {
  if (value === undefined || value === null) return undefined

  const flat = String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return flat || undefined
}

/**
 * Ask one wiki about fifty files.
 *
 * @param {string} api
 * @param {Array<string>} files
 * @returns {Promise<Map<string, object>>}
 */
async function imageinfo(api, files) {
  /** @type {Map<string, object>} */
  const out = new Map()

  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50)
    const url =
      api +
      '?action=query&format=json&formatversion=2&prop=imageinfo' +
      '&iiprop=extmetadata%7Curl%7Csize%7Cmime%7Cuser&iiextmetadatafilter=' +
      ['LicenseShortName', 'License', 'UsageTerms', 'Artist', 'Credit', 'Restrictions', 'DateTimeOriginal', 'ObjectName', 'AttributionRequired']
        .join('%7C') +
      '&titles=' +
      batch.map((file) => encodeURIComponent('File:' + file)).join('%7C')

    const body = await get(url)

    for (const page of body.query?.pages ?? []) {
      if (page.missing) continue

      const info = page.imageinfo?.[0]

      if (info) out.set(key(page.title.replace(/^File:/, '')), info)
    }
  }

  return out
}

/** A Commons thumbnail URL at `width`, from the one the importer recorded. */
function thumb(src, width) {
  // `.../thumb/a/ae/Name.jpg/500px-Name.jpg` — only the last segment carries
  // the size, and an SVG's thumb is a PNG whose name keeps the `.svg` in it.
  const match = /^(.*\/)(\d+)px-([^/]+)$/.exec(src)

  return match ? match[1] + width + 'px-' + match[3] : undefined
}

// ---------------------------------------------------------------- read

/** @type {Map<string, {src?: string, width?: number, height?: number, used: Set<string>}>} */
const wanted = new Map()

/** The file a Commons thumbnail URL is a thumbnail OF. */
function fileOf(src) {
  // `…/thumb/a/ae/Name.jpg/500px-Name.jpg` — the segment before the size is
  // the file, percent-encoded, and the front matter spells it decoded.
  const match = /\/thumb\/[^/]+\/[^/]+\/([^/]+)\//.exec(String(src))

  if (match) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }

  // Not every image URL is a thumbnail. The front matter's own `image` — the
  // lead picture, which is what a page opens on — is often the file itself,
  // and it is the one image a hero is most likely to need.
  const direct = /\/([^/?#]+\.(?:jpe?g|png|gif|svg|webp|tiff?))(?:[?#]|$)/i.exec(String(src))

  if (!direct) return

  try {
    return decodeURIComponent(direct[1])
  } catch {
    return direct[1]
  }
}

for (const name of (await readdir(join(root, lang))).filter((n) => n.endsWith('.mdy'))) {
  const source = await readFile(join(root, lang, name), 'utf8')
  const matter = /^\+\+\+\n([\s\S]*?)\n\+\+\+\n([\s\S]*)$/.exec(source)

  if (!matter) continue

  const slug = name.slice(0, -'.mdy'.length)
  const add = (file, image) => {
    const entry = wanted.get(file) ?? {used: new Set()}

    entry.src ??= image.src
    entry.width ??= image.width
    entry.height ??= image.height
    entry.used.add(slug)
    wanted.set(file, entry)
  }

  const data = YAML.parse(matter[1])

  for (const image of data.images ?? []) {
    if (image.file) add(image.file, image)
  }

  // The infobox picture. It is named only as a URL and appears in no list, so
  // without this a page's own lead image can be the one thing on it with no
  // licence — which is exactly backwards.
  if (data.image) {
    const file = fileOf(data.image)

    if (file) add(file, {src: data.image})
  }

  // And the ones only the body has. The front matter's `images` list is a
  // record of the images an article shows, and it is not a complete one: the
  // bodies of this corpus carry 585 distinct pictures against the front
  // matter's 536. The missing 49 are why a rewrite's image plan can name a
  // photograph nothing here has the rights for.
  // Attributes on ONE line, because MDY has no closing tags: `<img src="…"
  // width="180"` simply ends. `[^>]*` therefore runs across newlines until it
  // meets a `>` somewhere in later prose, swallowing every image in between —
  // which is why images that are plainly in the body had no rights record and
  // could not be shown.
  for (const [, src] of String(matter[2]).matchAll(/<img[^\n]*?src="([^"]+)"/g)) {
    const file = fileOf(src)

    if (file) add(file, {src})
  }
}

const files = [...wanted.keys()]

console.log(`${files.length} distinct files across ${(await readdir(join(root, lang))).length} documents`)

// -------------------------------------------------------------- resolve

const commons = await imageinfo('https://commons.wikimedia.org/w/api.php', files)
const local = await imageinfo(
  `https://${lang}.wikipedia.org/w/api.php`,
  files.filter((file) => !commons.has(key(file)))
)

const missing = files.filter((file) => !commons.has(key(file))).length

console.log(`  on Commons: ${files.length - missing}   not on Commons: ${missing}`)

// --------------------------------------------------------------- decide

/** @type {Record<string, object>} */
const images = {}
const dropped = []

for (const file of files) {
  const entry = wanted.get(file)
  const info = commons.get(key(file))
  const meta = info?.extmetadata ?? {}
  const licence = text(meta.LicenseShortName?.value)
  const terms = text(meta.UsageTerms?.value)
  const restrictions = text(meta.Restrictions?.value)

  // A file Commons does not have is a file Commons would not take.
  if (!info) {
    dropped.push({
      file,
      reason: local.has(key(file))
        ? 'local upload — non-free on ' + lang + '.wikipedia'
        : 'not on Commons and not local',
      used: [...entry.used]
    })
    continue
  }

  // `Restrictions` is not a copyright status. It is Commons warning that
  // something else applies on top of a free licence — a trademark, an
  // official insignia, a personality right — and reading it as "non-free"
  // threw away a CC BY-SA 3.0 drawing and the flag of Iraq. It rides along as
  // a caution for whoever lays the page out; only the licence can drop a file.
  if ((terms && unfree.test(terms)) || (licence && unfree.test(licence))) {
    dropped.push({file, reason: 'non-free: ' + (terms ?? licence), used: [...entry.used]})
    continue
  }

  // A CC licence requires attribution, so an image under one with no `Artist`
  // is not "author unknown" — it is an attribution we have not found yet. The
  // uploader is who Commons itself credits in that case. A public-domain relief
  // carved in 645 BC genuinely has no author, and says so.
  const attribute = /^cc/i.test(licence ?? '')
  const author =
    text(meta.Artist?.value) ??
    (attribute && info.user ? info.user + ' (uploader)' : undefined)
  const width = info.width ?? entry.width

  // Never ask for more pixels than exist: the thumbnailer will render them,
  // and an upscaled hero is worse than a smaller one.
  const sizes = {}

  for (const w of widths) {
    if (width && w > width) continue

    const url = thumb(entry.src ?? '', w)

    if (url) sizes[w] = url
  }

  images[file] = {
    licence: licence ?? 'unknown',
    'licence-id': text(meta.License?.value),
    author: author ?? 'unknown',
    credit: text(meta.Credit?.value),
    'usage-terms': terms,
    caution: restrictions,
    date: text(meta.DateTimeOriginal?.value),
    'descriptor-url': info.descriptionurl,
    mime: info.mime,
    width: info.width,
    height: info.height,
    original: info.url,
    sizes,
    used: [...entry.used].sort()
  }
}

const named = Object.values(images).filter((i) => i.licence !== 'unknown' && i.author !== 'unknown')
const owed = Object.values(images).filter((i) => /^cc/i.test(i.licence) && i.author === 'unknown')

console.log(`  kept ${Object.keys(images).length}, dropped ${dropped.length}`)
console.log(`  licence and author both named: ${named.length}/${Object.keys(images).length}`)
console.log(`  under a licence that requires attribution, with none: ${owed.length}`)

await writeFile(
  join(root, 'images.yaml'),
  YAML.stringify(
    {
      about: 'Image rights for the ' + lang + ' corpus. Generated by pipeline/enrich-images.mjs.',
      generated: new Date().toISOString().slice(0, 10),
      images,
      dropped
    },
    {lineWidth: 78}
  )
)

console.log(`wrote ${join(root, 'images.yaml')}`)

// ------------------------------------------------------------- download

if (download) {
  const out = join('static', 'img')
  let got = 0

  for (const [file, image] of Object.entries(images)) {
    for (const [width, url] of Object.entries(image.sizes)) {
      const path = join(out, width, file.replace(/[^\w.-]/g, '_'))

      if (await readFile(path).catch(() => undefined)) continue

      const response = await fetch(url, {headers: {'user-agent': agent}})

      if (!response.ok) continue

      await mkdir(dirname(path), {recursive: true})
      await writeFile(path, Buffer.from(await response.arrayBuffer()))
      await sleep(100)
      got += 1
    }
  }

  console.log(`downloaded ${got} derivatives into ${out}`)
}
