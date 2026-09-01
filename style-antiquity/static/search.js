/*
 * Search over the whole corpus, in the browser.
 *
 * The index is built at build time with `$.tokenize`, which is the host's own
 * word-list algorithm — the same one nisaba uses — so what this matches on is
 * exactly what a query against the document set would have matched on.
 *
 * Two kinds of record: an article, and a glossary term. A term wins ties,
 * because somebody typing "lamassu" wants the definition first and the article
 * it came from second.
 */
(function () {
  var input = document.getElementById('search-input')
  var results = document.getElementById('search-results')

  if (!input || !results) return

  var index = null
  var loading = null

  function load() {
    if (index) return Promise.resolve(index)
    if (!loading) {
      loading = fetch('/search-index.json')
        .then(function (r) { return r.json() })
        .then(function (data) { index = data; return index })
        .catch(function () { index = []; return index })
    }
    return loading
  }

  function score(record, needles) {
    var total = 0

    for (var i = 0; i < needles.length; i += 1) {
      var needle = needles[i]
      var best = 0

      for (var j = 0; j < record.w.length; j += 1) {
        var word = record.w[j]
        if (word === needle) { best = 3; break }
        if (word.indexOf(needle) === 0 && best < 2) best = 2
      }

      if (!best) return 0
      total += best
    }

    // The title is worth more than the body it sits above.
    if (record.t.toLowerCase().indexOf(needles.join(' ')) !== -1) total += 4
    if (record.k === 'term') total += 1

    return total
  }

  function render(matches) {
    results.textContent = ''

    matches.slice(0, 12).forEach(function (m) {
      var li = document.createElement('li')
      var a = document.createElement('a')

      a.href = m.record.u
      a.textContent = m.record.t

      var kind = document.createElement('span')
      kind.className = 'result-kind'
      kind.textContent = m.record.k === 'term' ? 'term' : 'article'

      var d = document.createElement('span')
      d.className = 'result-note'
      d.textContent = m.record.d

      a.appendChild(kind)
      li.appendChild(a)
      li.appendChild(d)
      results.appendChild(li)
    })

    results.hidden = matches.length === 0
  }

  function run() {
    var query = input.value.trim().toLowerCase()

    if (query.length < 2) { results.hidden = true; return }

    load().then(function (data) {
      var needles = query.split(/\s+/)
      var matches = []

      for (var i = 0; i < data.length; i += 1) {
        var s = score(data[i], needles)
        if (s) matches.push({ record: data[i], score: s })
      }

      matches.sort(function (a, b) { return b.score - a.score })
      render(matches)
    })
  }

  input.addEventListener('input', run)
  input.addEventListener('focus', load)
  document.addEventListener('click', function (e) {
    if (!results.contains(e.target) && e.target !== input) results.hidden = true
  })
})()
