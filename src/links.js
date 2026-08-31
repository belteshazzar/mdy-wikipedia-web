/**
 * Finding a link in the source that an article was rendered from.
 *
 * The reader can take a link out of a document, and to do that it has to say
 * which `[[ … ]]` in the source the one that was clicked is. Its own file
 * because that question is answerable without a browser, and worth answering
 * exactly: getting it wrong edits the wrong words.
 */

import {parseWikiLink} from 'mdy-docs/parse/wiki.js'

/**
 * The nth link to `href` in a run of source.
 *
 * What counts as a link is `parseWikiLink`'s answer rather than a pattern of
 * this file's own, so only what the parser read as a link can be found here —
 * and a `[[` inside a label cannot be mistaken for the start of another one,
 * because the search resumes past the whole link rather than past the two
 * brackets that opened it.
 *
 * @param {string} source
 * @param {string} href
 *   Where the link points, exactly as the article's `href` has it.
 * @param {number} [nth=0]
 *   Which of the links to that same page is wanted, counted from the start of
 *   `source`. An article can name the same page several times in a paragraph,
 *   and only one of them was clicked.
 * @returns {{start: number, end: number, label: string} | undefined}
 *   Where it is, and what it says — which is what should be left in its place.
 */
export function findWikiLink(source, href, nth = 0) {
  let index = 0
  let seen = 0

  while ((index = source.indexOf('[[', index)) !== -1) {
    const found = parseWikiLink(source, index)

    if (found?.url === href) {
      if (seen === nth) {
        return {start: index, end: index + found.length, label: found.label}
      }

      seen += 1
    }

    index += found ? found.length : 2
  }
}

/**
 * The source with that link taken out and its label left behind.
 *
 * The sentence keeps its words and loses only the fact that one of them
 * pointed somewhere. Returns `undefined` when the link is not there, so the
 * caller can say nothing was changed rather than change nothing and say so.
 *
 * @param {string} source
 * @param {string} href
 * @param {number} [nth=0]
 * @returns {string | undefined}
 */
export function removeWikiLink(source, href, nth = 0) {
  const found = findWikiLink(source, href, nth)

  if (!found) return

  return source.slice(0, found.start) + found.label + source.slice(found.end)
}
