import assert from 'node:assert/strict'
import test from 'node:test'
import {findWikiLink, removeWikiLink} from '../src/links.js'

const babylonia = 'https://en.wikipedia.org/wiki/Babylonia'
const hillah = 'https://en.wikipedia.org/wiki/Hillah'
const link = (label, url) => '[[ ' + label + ' | ' + url + ' ]]'

test('a link is found by where it points', () => {
  const source = 'About ' + link('Babylonia', babylonia) + '.'

  assert.deepEqual(findWikiLink(source, babylonia), {
    start: 6,
    end: source.length - 1,
    label: 'Babylonia'
  })
})

test('the one that was clicked is the one that goes', () => {
  const source =
    'First ' + link('Babylonia', babylonia) +
    ', then ' + link('Hillah', hillah) +
    ', then ' + link('Babylonia', babylonia) + '.'

  assert.equal(
    removeWikiLink(source, babylonia, 1),
    'First ' + link('Babylonia', babylonia) + ', then ' + link('Hillah', hillah) + ', then Babylonia.'
  )
})

test('what the link said is what is left behind', () => {
  const source = 'The ' + link('city of Babylon', babylonia) + ' fell.'

  assert.equal(removeWikiLink(source, babylonia), 'The city of Babylon fell.')
})

test('a link nobody asked about is left alone', () => {
  const source = 'About ' + link('Hillah', hillah) + '.'

  assert.equal(removeWikiLink(source, babylonia), undefined)
  assert.equal(findWikiLink(source, babylonia), undefined)
})

test('asking for one more than there are finds nothing', () => {
  const source = 'About ' + link('Babylonia', babylonia) + '.'

  assert.equal(removeWikiLink(source, babylonia, 1), undefined)
})

test('brackets inside a label do not start another link', () => {
  const source = 'A ' + link('a [[ b', babylonia) + ' and ' + link('Babylonia', babylonia) + '.'

  assert.equal(removeWikiLink(source, babylonia, 1), 'A ' + link('a [[ b', babylonia) + ' and Babylonia.')
})

// The parser reads `[[` to the first `]]` whatever is in between, so an
// unclosed one swallows the next link and the article shows a single link
// labelled with the lot. Removing it has to leave exactly that, because that
// is what was on the screen to click.
test('an unclosed bracket swallows the next link, here as it does when parsed', () => {
  const source = 'A [[ never closed, then ' + link('Babylonia', babylonia) + '.'

  assert.equal(removeWikiLink(source, babylonia), 'A never closed, then [[ Babylonia.')
})

test('a wiki link with no url is not a link to anywhere', () => {
  assert.equal(removeWikiLink('A [[ Babylonia ]] here.', babylonia), undefined)
})
