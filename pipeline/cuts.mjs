/**
 * Which places are cities of the ancient world, which are not, and which
 * nobody can tell from the data.
 *
 * A corpus boundary is an editorial decision and SPARQL cannot make it. These
 * are the decisions, in one file because two scripts need them and a rule
 * written down twice is a rule that will disagree with itself: `cities.mjs`
 * reports on a region, `seed.mjs` fills the queue, and both sort the same way.
 *
 * The answer is three-valued, which is the part worth arguing about. A cut
 * that has to say yes or no will say no to Skara Brae, so this says
 * `unsorted` instead and puts it in front of a person.
 *
 * THE CUTS
 *
 *   MONUMENT — a pyramid, a temple, an arch, a wall or a tomb is a thing IN a
 *   city, not a city. Wikidata's `archaeological site` covers a settlement and
 *   a single monument equally, so the class alone gives Ur and the Great
 *   Sphinx the same standing.
 *
 *   Read two ways, because one is not enough. The title regex was written for
 *   the Near East and holds there; run globally it waves through the
 *   Colosseum, Stonehenge, the Terracotta Army, the Nazca lines and the Roman
 *   Forum, none of which are named after the kind of thing they are. So the
 *   query also walks P31/P279* to a set of monument classes, which catches
 *   those by what they are rather than what they are called.
 *
 *   Both defer to a settlement class. Mari, Amarna and Ebla each carry one
 *   monument class — the temple or the palace that was dug there — and each is
 *   a city in the 49. A place Wikidata calls a settlement is a settlement with
 *   a monument in it, which is what a city is.
 *
 *   FOUNDED TOO LATE — Cairo is 969 and Samarra 836. They are ancient-adjacent
 *   and their articles are about the modern city: 42 sections of climate
 *   normals and football clubs.
 *
 *   STILL GOVERNED — the cut the founding date cannot make. Ranked by
 *   sitelinks the query opens London (AD 47), Jerusalem, Edirne (AD 125) and
 *   Venice (421): ancient foundations, every one inside the date bound, every
 *   one an article about a living city. What separates them from Ur is not
 *   when they began but that somebody governs them now.
 *
 * Both of the obvious signals for that last one fail alone:
 *
 *   - POPULATION alone cuts Babylon, whose P1082 is 150,000 — an estimate of
 *     the ancient city, not a census. Wikidata files a historical population
 *     in the same property as a current one.
 *   - TWIN TOWNS alone cut Petra, which has three: the modern municipality
 *     beside the ruins is twinned even though the article is about the ruins.
 *
 * Together they behave. A head of government is decisive on its own — nobody
 * appoints a mayor of Uruk — and a population *and* twin towns together mean a
 * place with a council in it. Petra has the twins and no population, Babylon
 * the population and no twins, and both survive, which is the test that
 * matters because both are in the 49.
 *
 * WHAT IS UNSORTED, AND WHY IT IS NOT A CUT
 *
 * 88 of 395 carry no settlement class and no monument class; the title regex
 * accounts for a dozen of them and 76 are left. Cutting on that absence is the
 * tempting mistake: it would take Megiddo, Qumran, Skara Brae,
 * Khirokitia, Jarmo, Mehrgarh, Phanagoria, Italica and Tanais with it, and
 * Carchemish, which is already in the corpus. Wikidata has simply not said
 * what they are. So absence of evidence is reported as absence of evidence,
 * the queue lists them in their own block, and a person sorts them — which is
 * a morning's work once, against a rule that would quietly cost the corpus its
 * Neolithic settlements forever.
 *
 * None of it is the last word. `queue.yaml` carries a hand-written `rejected`
 * list that survives a re-seed, anything cut is written into the queue with
 * its reason rather than vanishing from it, and a place already in the corpus
 * is never cut by rule at all.
 */

/** A thing inside a city rather than a city, by what it is called. */
export const MONUMENT =
  /\b(pyramid|pyramids|sphinx|temple|temples|tomb|tombs|wall|walls|arch|mosque|church|cathedral|obelisk|statue|colossi|gate|necropolis|monastery|ziggurat|valley of the kings|valley of the queens|catacombs?|aqueduct|theatre|amphitheatre)\b/i

/** Founded after this and it is not an ancient city, whatever else it is. */
export const LATEST = 500

/**
 * A Wikidata date to a signed year: `-2200-01-01T…` is −2200, `0047-01-01T…`
 * is 47. Wikidata pads a year to four digits, so the slice is safe either way.
 *
 * @param {string|number|undefined} from
 * @returns {number|undefined}
 */
export function year(from) {
  if (from === undefined || from === '') return undefined

  const bc = String(from).startsWith('-')
  const n = Number(String(from).replace(/^-/, '').slice(0, 4))

  return Number.isNaN(n) ? undefined : bc ? -n : n
}

/**
 * What this place is, as far as the data can say.
 *
 * @param {{title: string, from?: string|number, twins?: number, mayors?: number,
 *   people?: number, settled?: number, monumental?: number}} place
 *   As the query returns it. Every signal is optional, and each is only read
 *   when it is there: a caller working from data that predates them
 *   (`cities.json`) gets the title and date cuts and nothing that would need
 *   a column it has not got. An absent `settled` is not read as "no
 *   settlement class".
 * @returns {{state: 'candidate'|'cut'|'unsorted', why?: string}}
 */
export function sort(place) {
  const founded = year(place.from)
  const settled = place.settled === undefined ? undefined : Number(place.settled)
  const monumental = place.monumental === undefined ? undefined : Number(place.monumental)

  // Both monument tests defer to a settlement class, and the corpus is the
  // reason: Mari, Amarna and Ebla each carry one monument class — the temple
  // or the palace that was dug there — and each is a city already in the 49.
  // A place that Wikidata says is a settlement is a settlement with a monument
  // in it, which is what a city is.
  if (!settled) {
    if (MONUMENT.test(place.title)) return {state: 'cut', why: 'a monument, not a city'}

    if (monumental) {
      return {
        state: 'cut',
        why: `a monument, not a city — ${monumental} monument class on Wikidata`
      }
    }
  }

  if (founded !== undefined && founded > LATEST) {
    return {state: 'cut', why: `founded ${founded}, after antiquity`}
  }

  const twins = Number(place.twins ?? 0)
  const mayors = Number(place.mayors ?? 0)
  const people = Number(place.people ?? 0)

  if (mayors > 0) return {state: 'cut', why: 'still governed — it has a head of government'}
  if (people > 0 && twins > 0) {
    return {
      state: 'cut',
      why: `still lived in — population ${people.toLocaleString('en')}, ${twins} twinned ${
        twins === 1 ? 'town' : 'towns'
      }`
    }
  }

  if (settled === 0) {
    return {state: 'unsorted', why: 'Wikidata says neither settlement nor monument'}
  }

  return {state: 'candidate'}
}

/**
 * The old two-valued question, for callers that only want to know whether to
 * drop a row. `unsorted` is not a cut, so it answers `undefined`.
 *
 * @param {Parameters<typeof sort>[0]} place
 * @returns {string|undefined}
 */
export function cut(place) {
  const {state, why} = sort(place)

  return state === 'cut' ? why : undefined
}
