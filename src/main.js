/**
 * Read Wikipedia as mdy.
 *
 * The article on the right is not a preview of the conversion — it *is* the
 * document, parsed in the browser by the same parser the rest of the repo
 * uses, from the source on the left. Edit the source and the article follows,
 * which is the quickest way to see what a conversion decision actually did.
 *
 * The two panes and the editor between them are `@mdy-docs/mdy-site`'s, imported
 * rather than copied: the same textarea-with-a-painted-copy, the same MDY
 * colouring, the same stylesheet. A second implementation of an editor is a
 * second implementation to keep in step.
 *
 * A link in the article is a fork in the road rather than a jump: clicking one
 * asks whether to go and read that article or to take the link out of this one.
 * Taking it out edits the source, which is the document, so the article loses
 * the link in front of you and the vault keeps it lost.
 *
 * Script is **off**. A converted article is input this page did not write, and
 * `mdy({script})` runs it with `new Function` rather than in the sandbox — so
 * the Data tab reads `file.data.matter`, which is the front matter itself and
 * needs nothing executed to show it.
 */

import {mdy, scriptBrackets} from 'mdy-docs/parse'
import {createEditor} from '@mdy-docs/mdy-site/editor'
import {blockRegions, embed, highlightMdy} from '@mdy-docs/mdy-site/syntax'
import {setupTheme} from '@mdy-docs/mdy-site/theme'
import {followFragments, headingAnchors} from '@mdy-docs/mdy-site/anchor'
import '@mdy-docs/mdy-site/style.css'
import './reader.css'
import {removeWikiLink} from './links.js'

// The tree the article was made from, kept as the processor goes past rather
// than parsed for a second time. `render` wants both the HTML and the tree —
// the HTML to show, the tree for where each block started in the source — and
// parsing this document twice costs as much as everything else it does.
let parsed
const processor = mdy({tasks: true})
  .use(headingAnchors)
  .use(() => (tree) => {
    parsed = tree
  })
const wikiUrl = /^https?:\/\/([a-z-]+)\.(?:m\.)?wikipedia\.org\/wiki\/(.+)$/i
const views = [
  {id: 'preview', label: 'Article'},
  {id: 'data', label: 'Data'}
]

document.querySelector('#app').innerHTML = `
  <header class="bar">
    <div class="bar-title">
      <span class="glyph">MDY</span>
      <h1 id="page-title">Wikipedia as mdy</h1>
      <span class="badge" id="page-from" hidden></span>
    </div>
    <form class="bar-go" id="go">
      <input
        type="search"
        id="query"
        name="query"
        placeholder="An article, or a Wikipedia URL"
        aria-label="Article to read"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="submit" class="ghost">Read</button>
      <button type="button" class="ghost" id="refresh" title="Fetch again, past the cache">Refetch</button>
      <button
        type="button"
        class="ghost danger"
        id="discard"
        title="Delete this document from the vault and go back to the one before it"
        disabled
      >Discard</button>
    </form>
    <button type="button" class="theme" id="theme">
      <svg class="sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2v2.6M12 19.4V22M4.2 4.2l1.9 1.9M17.9 17.9l1.9 1.9M2 12h2.6M19.4 12H22M4.2 19.8l1.9-1.9M17.9 6.1l1.9-1.9" />
      </svg>
      <svg class="moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8z" />
      </svg>
    </button>
  </header>

  <nav class="shelf" aria-label="Converted articles">
    <ul id="shelf-list"></ul>
  </nav>

  <main class="playground reader">
    <section class="pane" aria-labelledby="source-heading">
      <div class="pane-head">
        <h2 id="source-heading">Source</h2>
        <div class="pane-tools">
          <span class="stat" id="stat-caret"></span>
          <span class="stat" id="stat-source"></span>
        </div>
      </div>
      <div id="editor-host"></div>
    </section>

    <section class="pane" aria-labelledby="output-heading">
      <div class="pane-head">
        <h2 id="output-heading">Output</h2>
        <div class="pane-tools">
          <div class="tabs" role="tablist" aria-label="Output view">
            ${views
              .map(
                (view, index) => `
              <button type="button" role="tab" id="tab-${view.id}"
                data-view="${view.id}" aria-controls="panel-output"
                aria-selected="${index === 0}">${view.label}</button>`
              )
              .join('')}
          </div>
        </div>
      </div>
      <div class="output" id="panel-output" role="tabpanel" aria-live="polite">
        <div class="rendered" id="rendered"></div>
        <pre class="code" id="code" hidden><code></code></pre>
      </div>
      <ul class="messages" id="messages" hidden></ul>
    </section>
  </main>

  <div class="linkmenu" id="link-menu" role="menu" hidden>
    <p class="linkmenu-target" id="link-menu-target"></p>
    <button type="button" role="menuitem" data-action="open">Download and show page</button>
    <button type="button" role="menuitem" data-action="remove">Remove link</button>
  </div>
`

setupTheme(document.querySelector('#theme'), localStorage)

const rendered = document.querySelector('#rendered')
const code = document.querySelector('#code')
const codeBody = code.querySelector('code')
const messageList = document.querySelector('#messages')
const sourceStat = document.querySelector('#stat-source')
const caretStat = document.querySelector('#stat-caret')
const pageTitle = document.querySelector('#page-title')
const pageFrom = document.querySelector('#page-from')
const shelf = document.querySelector('#shelf-list')
const query = document.querySelector('#query')
const tabs = [...document.querySelectorAll('[role="tab"]')]
const discard = document.querySelector('#discard')
const menu = document.querySelector('#link-menu')
const menuTarget = document.querySelector('#link-menu-target')

let view = 'preview'
let current
// The document that was open before this one, which is where discarding this
// one goes back to. A key rather than the page itself: by the time it is used
// the page it names may have been read again, and the fresher copy is the one
// wanted.
let previous
// What the reader itself has to say — that an edit did not save, that a link
// could not be found in the source. It outlives a render, which is why it is
// held here rather than passed to one.
let notice
// The link the menu is open on, and the article it points at.
let menuFor
// The scheduled render, and how long the last one took. A frame's worth of
// coalescing is enough when the document is small; a converted article is
// 125,000 characters, and parsing and re-rendering the whole of it is a fifth
// of a second that lands between one keystroke and the next. So the wait is
// what the work costs: a short document still follows every keystroke, and a
// long one waits for a pause rather than running a render nobody will see the
// end of.
//
// Declared up here with the rest of the state, because the first render runs
// while this module is still being evaluated.
let timer
let cost = 0
// Whether edits are arriving faster than the source can be coloured, and what
// colouring it costs. On a converted article the painted copy is a quarter of
// a million characters, and the browser lays all of it out again for every
// keystroke — which is what makes holding a key down feel stuck. While that is
// happening the colouring is put away and the textarea shows its own text,
// which is the one thing here the browser can do at speed.
let typing = false
let paintCost = 0

// Where a message came from, when it did not come from the parser: the
// conversion that wrote the document, or the reader's own editing of it.
const kinds = {convert: 'conversion', edit: 'edit'}

// What the badge says about where a document came from, which is the
// interesting part of following a link.
const from = {
  wikipedia: 'converted just now',
  vault: 'from the vault',
  memory: 'already converted'
}

const editorHost = document.querySelector('#editor-host')
const editor = createEditor(editorHost, {
  value: '',
  // Timed as it goes, because how long this takes is the measure of whether
  // the colouring can keep up at all — and mid-burst it is not asked for.
  highlight(source) {
    if (typing) return ''

    const started = performance.now()
    const html = highlightMdy(source)

    paintCost = performance.now() - started

    return html
  },
  regions: blockRegions,
  brackets: (source) => scriptBrackets(source.split('\n')),
  attributes: {id: 'editor', 'aria-label': 'MDY source'},
  onInput: schedule,
  onCaret({line, column}) {
    caretStat.textContent = `Ln ${line}, Col ${column}`
  }
})

followFragments(rendered)

// A link out of the article is a link into the reader, and there are two things
// worth doing with one: go and read it, or decide it should not have been a
// link and take it out. So a click asks rather than answers.
//
// Only links that name a Wikipedia article get the menu — reading the article
// is half of what it offers, and there is no article behind a citation's link
// to a newspaper. Those keep the behaviour they had, opened where they will not
// take this page with them, and so does a modifier-click on anything.
rendered.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]')

  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return

  const match = wikiUrl.exec(link.getAttribute('href'))

  if (!match) {
    if (/^https?:/.test(link.getAttribute('href'))) link.target = '_blank'

    return
  }

  event.preventDefault()
  openMenu(link, match[1] + ':' + decodeURIComponent(match[2].split('#')[0]).replaceAll('_', ' '), event)
})

menu.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]')

  if (!button || !menuFor) return

  const {link, page} = menuFor

  closeMenu()

  if (button.dataset.action === 'open') open(page)
  else removeLink(link)
})

// Everything that means "not that, then": the key for it, a click anywhere
// else, and the two ways the menu can end up pointing at a place on the screen
// where its link no longer is.
addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenu()
})

addEventListener('pointerdown', (event) => {
  if (!menu.hidden && !menu.contains(event.target)) closeMenu()
}, true)

addEventListener('resize', closeMenu)
rendered.addEventListener('scroll', closeMenu)

document.querySelector('#go').addEventListener('submit', (event) => {
  event.preventDefault()

  if (query.value.trim()) open(query.value.trim())
})

document.querySelector('#refresh').addEventListener('click', () => {
  if (current) open(current.lang + ':' + current.title, {refresh: true})
})

discard.addEventListener('click', discardPage)

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    view = tab.dataset.view

    for (const other of tabs) other.setAttribute('aria-selected', String(other === tab))

    render()
  })
}

addEventListener('popstate', (event) => {
  if (event.state?.page) open(event.state.page, {history: 'none'})
})

const first = new URL(location.href).searchParams.get('page')
const {opening} = await fetch('/api/pages').then((response) => response.json())

await open(first ?? opening, {history: 'replace'})
await refreshShelf()

/**
 * Show an article, fetching and converting it if this is the first time it has
 * been asked for.
 *
 * @param {string} input
 * @param {{history?: 'push' | 'replace' | 'none', refresh?: boolean}} [options]
 */
async function open(input, options = {}) {
  // Say what is being read and that it is being read. A conversion is a fetch
  // and a parse of half a megabyte, so there is a second or two here where the
  // page would otherwise be showing the last article with the wrong name on it.
  pageTitle.textContent = input.replace(/^[a-z-]{2,3}:/i, '')
  pageFrom.hidden = false
  pageFrom.textContent = 'reading…'
  pageFrom.dataset.from = 'loading'
  document.body.classList.add('is-loading')

  let page

  try {
    const response = await fetch(
      '/api/page?title=' + encodeURIComponent(input) + (options.refresh ? '&refresh=1' : '')
    )

    page = await response.json()

    if (!response.ok) throw new Error(page.error ?? response.statusText)
  } catch (error) {
    document.body.classList.remove('is-loading')
    pageFrom.textContent = 'could not be read'
    pageFrom.dataset.from = 'failed'
    showMessages([{fatal: true, reason: 'Could not read ' + input + ': ' + error.message}])

    return
  }

  document.body.classList.remove('is-loading')

  if (current && current.key !== page.key) previous = current.lang + ':' + current.title

  current = page
  notice = undefined
  editor.value = page.source
  pageTitle.textContent = page.title
  pageFrom.hidden = false
  pageFrom.textContent = from[page.from]
  pageFrom.dataset.from = page.from
  query.value = ''
  document.title = page.title + ' — Wikipedia as mdy'

  // The first entry is replaced rather than pushed, and it carries its state:
  // without that, going back to it arrives at a `popstate` with nothing on it
  // and the reader has no idea what to show.
  const key = page.lang + ':' + page.title

  if (options.history !== 'none') {
    history[options.history === 'replace' ? 'replaceState' : 'pushState'](
      {page: key},
      '',
      '?page=' + encodeURIComponent(key)
    )
  }

  render()
  rendered.scrollTop = 0
  await refreshShelf()
}

/** Whether there is a document to act on. */
function settle() {
  discard.disabled = !current
}

/**
 * Ask what to do with a link, where the link is.
 *
 * @param {HTMLAnchorElement} link
 * @param {string} page
 *   The article it points at, as `lang:title`.
 * @param {MouseEvent} event
 */
function openMenu(link, page, event) {
  menuFor = {link, page}
  menuTarget.textContent = page.replace(/^[a-z-]{2,3}:/i, '')
  menu.hidden = false

  // Measured after it is shown, because a hidden element has no size, and
  // clamped to the window so a link near the bottom right does not open a menu
  // half of which is off the screen.
  const box = menu.getBoundingClientRect()

  menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - box.width - 8)) + 'px'
  menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - box.height - 8)) + 'px'
  menu.querySelector('button').focus()
}

function closeMenu() {
  menu.hidden = true
  menuFor = undefined
}

/**
 * Take a link out of the document.
 *
 * The article is not edited — the source is, and the article follows, the same
 * way it follows a keystroke in the editor. Then it is saved, because an edit
 * that lasted only as long as the render would be a worse answer than not
 * offering to make it.
 *
 * @param {HTMLAnchorElement} link
 */
async function removeLink(link) {
  const source = editor.value
  const {from, scope, nth} = locate(source, link)
  const edited = removeWikiLink(scope, link.getAttribute('href'), nth)

  if (edited === undefined) {
    notice =
      'That link is in the article but not in the source as a `[[ … ]]` link, ' +
      'so nothing was changed.'
    render()

    return
  }

  editor.value = source.slice(0, from) + edited + source.slice(from + scope.length)
  notice = undefined
  render()
  await saveEdit()
}

/**
 * Which part of the source the clicked link is in, and which link it is.
 *
 * Two narrowings, because neither is enough on its own. The block bounds the
 * search — the tree carries positions for blocks and for nothing finer, so a
 * paragraph is as close as the render can say. Then the link's place among the
 * links to the same article *in that block* picks between the several times a
 * paragraph can name the same page.
 *
 * Without a block — nothing anchored, or a link somewhere the anchoring did not
 * reach — the scope is the whole document and the count is taken over the whole
 * article, which is slower and still right.
 *
 * @param {string} source
 * @param {HTMLAnchorElement} link
 * @returns {{from: number, scope: string, nth: number}}
 */
function locate(source, link) {
  const block = link.closest('[data-mdy-start]')
  const from = block ? Number(block.dataset.mdyStart) : 0
  const scope = source.slice(from, block ? Number(block.dataset.mdyEnd) : source.length)
  const nth = [...(block ?? rendered).querySelectorAll('a[href]')]
    .filter((other) => other.getAttribute('href') === link.getAttribute('href'))
    .indexOf(link)

  return {from, scope, nth}
}

/**
 * Put the edited source back where the document is kept.
 */
async function saveEdit() {
  if (!current) return

  try {
    const response = await fetch('/api/page', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        title: current.lang + ':' + current.title,
        source: editor.value
      })
    })
    const page = await response.json()

    if (!response.ok) throw new Error(page.error ?? response.statusText)

    current = page
    pageFrom.hidden = false
    pageFrom.dataset.from = 'edited'
    // Without a vault there is nowhere to write it, and an edit that will be
    // gone when the tab closes should say so rather than look like one that
    // will not.
    pageFrom.textContent = page.saved ? 'edited' : 'edited, not kept'
  } catch (error) {
    notice = 'The edit is on the page but was not saved: ' + error.message
    render()
  }
}

/**
 * Undo a download: take this document out of the vault, and go back.
 *
 * Following a link reads a page and keeps it, which is what makes the second
 * visit instant and the vault worth having — until the link was a wrong turn,
 * and then keeping it is the problem. This is that turn taken back.
 *
 * The history entry goes with it rather than being stepped back over. Stepping
 * back would leave the discarded page one *forward* press away, and arriving
 * there would fetch and keep it all over again — which is the one thing this
 * button exists to undo.
 */
async function discardPage() {
  if (!current) return

  const key = current.lang + ':' + current.title

  discard.disabled = true

  try {
    const response = await fetch('/api/page?title=' + encodeURIComponent(key), {
      method: 'DELETE'
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))

      throw new Error(body.error ?? response.statusText)
    }
  } catch (error) {
    notice = 'Could not discard ' + key + ': ' + error.message
    discard.disabled = false
    render()

    return
  }

  // Where to go instead: where this was arrived from, or failing that whatever
  // else the library still holds. Nothing is asked of Wikipedia — a discard
  // that ended in a download would not be one.
  const {pages} = await fetch('/api/pages').then((response) => response.json())
  const back =
    previous && previous !== key
      ? previous
      : pages
          .map((page) => page.lang + ':' + page.title)
          .find((other) => other !== key)

  // Let go of it before going anywhere, or the page being left would be
  // recorded as somewhere to go back *to* — and the next discard would fetch
  // the one just discarded all over again.
  previous = undefined
  current = undefined

  if (back) {
    await open(back, {history: 'replace'})

    return
  }

  showNothing()
  await refreshShelf()
}

/**
 * The reader with nothing open: the last document discarded, and none left to
 * go back to.
 */
function showNothing() {
  current = undefined
  notice = undefined
  editor.value = ''
  pageTitle.textContent = 'Wikipedia as mdy'
  pageFrom.hidden = true
  document.title = 'Wikipedia as mdy'
  history.replaceState({}, '', location.pathname)
  render()
}

async function refreshShelf() {
  const {pages} = await fetch('/api/pages').then((response) => response.json())

  shelf.innerHTML = pages
    .map((page) => {
      const key = page.lang + ':' + page.title
      const here = current && key === current.lang + ':' + current.title

      return (
        `<li><button type="button" data-page="${escapeHtml(key)}"` +
        (here ? ' class="is-current" aria-current="page"' : '') +
        `>${escapeHtml(page.title)}` +
        (page.lang === 'en' ? '' : ` <span class="lang">${escapeHtml(page.lang)}</span>`) +
        '</button></li>'
      )
    })
    .join('')

  for (const button of shelf.querySelectorAll('button')) {
    button.addEventListener('click', () => open(button.dataset.page))
  }
}

function schedule() {
  // A second edit arriving before the first has been drawn is a burst, and only
  // then is the colouring worth dropping: one keystroke on its own would just
  // flicker. Only when producing it costs more than a frame, too — under that
  // it is keeping up and there is nothing to fix.
  if (timer !== undefined && !typing && paintCost > 8) {
    typing = true
    editorHost.classList.add('is-typing')
  }

  clearTimeout(timer)
  timer = setTimeout(render, Math.min(400, Math.max(16, cost)))
}

function render() {
  // Anything that renders on purpose — opening a page, removing a link — has a
  // scheduled render behind it that would only do the same work again.
  clearTimeout(timer)
  timer = undefined

  // The burst is over: colour the source again, and the article with it.
  if (typing) {
    typing = false
    editorHost.classList.remove('is-typing')
    editor.refresh()
  }

  const started = performance.now()

  try {
    draw()
  } finally {
    cost = performance.now() - started
  }
}

function draw() {
  closeMenu()
  settle()

  const source = editor.value
  /** @type {import('vfile').VFile} */
  let file
  /** @type {import('hast').Root} */
  let tree

  try {
    file = processor.processSync(source)
    tree = parsed
  } catch (error) {
    showMessages([{fatal: true, reason: error.message}])

    return
  }

  showMessages([
    ...(notice ? [{reason: notice, kind: 'edit'}] : []),
    ...(current?.messages ?? []).map((reason) => ({reason, kind: 'convert'})),
    ...file.messages
  ])

  const blocks = tree.children.length

  sourceStat.textContent =
    `${source.length} chars · ${blocks} block${blocks === 1 ? '' : 's'}`

  rendered.hidden = view !== 'preview'
  code.hidden = view === 'preview'

  if (view === 'preview') {
    rendered.innerHTML = blocks ? String(file) : '<p class="empty">Nothing yet.</p>'
    anchorBlocks(source, tree)

    return
  }

  // The front matter, which is what the conversion was for. Read off the file
  // rather than out of a template, so nothing has to run for it to show.
  const data = file.data.matter

  codeBody.innerHTML =
    data === undefined
      ? '<span class="empty">No front matter.</span>'
      : embed(JSON.stringify(data, undefined, 2), 'json')
}

/**
 * Say where in the source each block of the article came from.
 *
 * The parse tree carries positions for blocks and nothing finer, so a paragraph
 * is as close as a click can be narrowed before the source has to be read
 * itself. That is close enough: what is left to tell apart inside one is the
 * handful of links it holds.
 *
 * Nothing is marked if the two do not line up one for one. A transform that
 * added or dropped a block would put every anchor after it on the wrong
 * paragraph, and a wrong anchor is worse than none — without one the search
 * falls back to the whole document, which is slower and still right.
 *
 * @param {string} source
 * @param {import('hast').Root} tree
 */
function anchorBlocks(source, tree) {
  const blocks = tree.children.filter((node) => node.type === 'element' && node.position)
  const elements = [...rendered.children]

  if (elements.length !== blocks.length) return

  const at = offsetIn(source)

  elements.forEach((element, index) => {
    element.dataset.mdyStart = String(at(blocks[index].position.start))
    element.dataset.mdyEnd = String(at(blocks[index].position.end))
  })
}

/**
 * Line and column, which is what a position is, to an index into the string,
 * which is what slicing one wants.
 *
 * @param {string} source
 * @returns {(point: {line: number, column: number}) => number}
 */
function offsetIn(source) {
  const lines = [0]

  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) lines.push(index + 1)
  }

  return ({line, column}) => lines[line - 1] + column - 1
}

/** @param {Array<{fatal?: boolean | null, reason: string, line?: number | null, kind?: string}>} messages */
function showMessages(messages) {
  messageList.hidden = messages.length === 0
  messageList.innerHTML = messages
    .map(
      (message) =>
        `<li class="${message.fatal ? 'fatal' : (message.kind ?? 'warn')}">` +
        (kinds[message.kind] ? `<b>${kinds[message.kind]}</b> ` : '') +
        (message.line ? `<b>line ${message.line}</b> ` : '') +
        escapeHtml(message.reason) +
        '</li>'
    )
    .join('')
}

/** @param {string} value */
function escapeHtml(value) {
  return value.replace(
    /[&<>"]/g,
    (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[character]
  )
}
