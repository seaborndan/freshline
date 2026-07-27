/**
 * The address bar is the application's state.
 *
 * A filtered view of a city is worth sharing, and a URL is how people share things. That is most of
 * what makes this a portfolio link rather than a demo: the map you send someone is the map they see.
 *
 * **No router.** There is one page, no route matching and no nested layouts, so a router would be
 * added to wrap the two browser APIs actually in use. `URLSearchParams` and `history.replaceState`
 * are those APIs.
 *
 * **`replaceState`, never `pushState`.** The viewport is written on every pan, and pushing a history
 * entry per pan turns the back button into an undo-my-panning key and traps the user on the page.
 * Sharing needs the address bar to be right; it does not need every intermediate viewport to be a
 * document in the session history.
 *
 * ## A decision reversed, with the reason
 *
 * `docs/milestones/m5-map-ui.md` committed to putting a **centre and a zoom** in the URL rather than
 * a bounding box, on the grounds that a box is a function of the window: the same box frames
 * different amounts of city on a phone and on a laptop, while a centre and a zoom reopen the same
 * place.
 *
 * That reasoning holds for "look at this point" and is backwards for this product, which is about
 * areas. `fitBounds` guarantees a shared box is **entirely visible** on whatever screen opens it —
 * a phone shows that area plus more. Centre and zoom guarantee the opposite: the phone shows a
 * fraction of what the sender saw, silently. Since the whole application already speaks in bounding
 * boxes — the request, the validator's containment check, the map's own report — the box also
 * removes a second camera representation and the conversions between them.
 *
 * Recorded rather than quietly changed, and the four bounds are written under the API's own names so
 * a reader can compare the address bar with the request it produces.
 */

import type { EstablishmentFilter, InspectionOutcome } from '../api/contract'
import { inspectionOutcomes } from '../api/contract'
import { formatCoordinate, viewportProblem, type Viewport } from '../api/viewport'

export interface MapUrlState {
  /** Null means "no viewport in the URL" — the caller falls back to the committed opening view. */
  viewport: Viewport | null
  filters: EstablishmentFilter
}

export const emptyUrlState: MapUrlState = { viewport: null, filters: {} }

function readNumber(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name)

  if (raw === null || raw.trim() === '') {
    return null
  }

  const value = Number(raw)

  return Number.isFinite(value) ? value : null
}

/**
 * The state a URL asks for, or as much of it as is usable.
 *
 * **Nothing here is trusted.** A query string is user-editable text on its way to an API that
 * answers a bad enum with a `400` and a bad viewport with another. Every value is validated, and an
 * unusable one is dropped rather than made fatal: someone who follows a link with one broken
 * parameter should get the rest of the view, not an error page. A viewport that fails the API's own
 * rules falls back to the opening view for the same reason.
 */
export function readUrlState(search: string): MapUrlState {
  const params = new URLSearchParams(search)

  const filters: EstablishmentFilter = {}

  const name = params.get('name')?.trim()
  if (name !== undefined && name !== '') {
    filters.nameStartsWith = name
  }

  const cuisine = params.get('cuisine')?.trim()
  if (cuisine !== undefined && cuisine !== '') {
    filters.cuisine = cuisine
  }

  const locality = params.get('locality')?.trim()
  if (locality !== undefined && locality !== '') {
    filters.locality = locality
  }

  // Checked against the known set rather than passed through. `?outcome=Banana` would be a 400, and
  // a link with a typo in it should still show a map.
  const outcome = params.get('outcome')?.trim()
  if (outcome !== undefined && (inspectionOutcomes as readonly string[]).includes(outcome)) {
    filters.outcome = outcome as InspectionOutcome
  }

  // Only the two spellings that mean something. Anything else is not a tri-state, it is a typo.
  const uninspected = params.get('uninspected')
  if (uninspected === 'true' || uninspected === 'false') {
    filters.awaitingFirstInspection = uninspected === 'true'
  }

  const minLatitude = readNumber(params, 'minLat')
  const maxLatitude = readNumber(params, 'maxLat')
  const minLongitude = readNumber(params, 'minLon')
  const maxLongitude = readNumber(params, 'maxLon')

  if (
    minLatitude === null ||
    maxLatitude === null ||
    minLongitude === null ||
    maxLongitude === null
  ) {
    return { viewport: null, filters }
  }

  const viewport: Viewport = { minLatitude, maxLatitude, minLongitude, maxLongitude }

  // The same rules the API enforces, applied before the request rather than after the 400.
  return { viewport: viewportProblem(viewport) === null ? viewport : null, filters }
}

/**
 * The query string for a state — `?` included, or empty when there is nothing to say.
 *
 * Written in a fixed order so that panning does not reshuffle the address bar, and coordinates at
 * the same six decimal places the request uses, so the URL and the query it produces agree exactly.
 */
export function writeUrlState(state: MapUrlState): string {
  const params = new URLSearchParams()
  const { filters, viewport } = state

  if (filters.nameStartsWith !== undefined && filters.nameStartsWith !== '') {
    params.set('name', filters.nameStartsWith)
  }

  if (filters.cuisine !== undefined) {
    params.set('cuisine', filters.cuisine)
  }

  if (filters.locality !== undefined) {
    params.set('locality', filters.locality)
  }

  if (filters.outcome !== undefined) {
    params.set('outcome', filters.outcome)
  }

  if (filters.awaitingFirstInspection !== undefined) {
    params.set('uninspected', String(filters.awaitingFirstInspection))
  }

  if (viewport !== null) {
    // Named as the API names them, so the address bar can be read against the request.
    params.set('minLat', formatCoordinate(viewport.minLatitude))
    params.set('maxLat', formatCoordinate(viewport.maxLatitude))
    params.set('minLon', formatCoordinate(viewport.minLongitude))
    params.set('maxLon', formatCoordinate(viewport.maxLongitude))
  }

  const query = params.toString()

  return query === '' ? '' : `?${query}`
}
