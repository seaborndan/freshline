/**
 * A rectangle of the world.
 *
 * **Named properties, never positional, and never a tuple.** This is the third coordinate-order
 * convention in this project: MapLibre takes `[longitude, latitude]`, NetTopologySuite's `Point`
 * takes `(X, Y)` which is longitude first, and T-SQL's `geography::Point` takes latitude first. A
 * swap throws nothing and relocates every restaurant to the Southern Ocean. Names make the mistake
 * unwritable in this file's own vocabulary, and `validate.ts` catches it at the one place names
 * cannot help — the query string, where they become `minLat` and `minLon`.
 */
export interface Viewport {
  minLatitude: number
  maxLatitude: number
  minLongitude: number
  maxLongitude: number
}

/**
 * The largest viewport the API will answer, on either axis. Mirrors `MaxViewportDegrees` in
 * `EstablishmentEndpoints`, where the reasoning lives: every establishment in the database falls
 * inside 0.41° of latitude by 0.55° of longitude, so one degree already covers every viewport that
 * could return anything.
 *
 * Duplicated rather than fetched, because it is a constant of the contract and a request that
 * violates it is a client bug. The cost of duplication is that this constant can drift from the
 * server's; the test asserting the whole-city box is acceptable is what would notice.
 */
export const maxViewportDegrees = 1

/**
 * Why the API would refuse this viewport, or null if it would accept it.
 *
 * Checked here so a doomed request never leaves the browser. The rate limiter allows a burst of 60
 * and refills 30 every 10 seconds; spending a token to be told 400 by rules already known is waste,
 * and on a map those requests arrive in bursts while panning.
 *
 * Returns a message rather than a boolean because both callers need to say something: the client
 * throws it, and the URL reader logs it before falling back to the initial viewport.
 */
export function viewportProblem(viewport: Viewport): string | null {
  const { minLatitude, maxLatitude, minLongitude, maxLongitude } = viewport

  if (
    !Number.isFinite(minLatitude) ||
    !Number.isFinite(maxLatitude) ||
    !Number.isFinite(minLongitude) ||
    !Number.isFinite(maxLongitude)
  ) {
    return 'A viewport bound is not a finite number.'
  }

  if (minLatitude < -90 || maxLatitude > 90 || minLongitude < -180 || maxLongitude > 180) {
    return 'Latitude must be between -90 and 90, longitude between -180 and 180.'
  }

  // Inverted rather than merely empty. Swapping a min and a max produces a silently empty map, which
  // looks exactly like a part of the city with no restaurants in it.
  if (minLatitude >= maxLatitude || minLongitude >= maxLongitude) {
    return 'minLatitude must be less than maxLatitude, and minLongitude less than maxLongitude.'
  }

  if (
    maxLatitude - minLatitude > maxViewportDegrees ||
    maxLongitude - minLongitude > maxViewportDegrees
  ) {
    return `A viewport may span at most ${maxViewportDegrees} degrees on each axis.`
  }

  return null
}

/**
 * Whether a point falls inside the viewport, with a tolerance.
 *
 * The tolerance is for the float arithmetic between reading bounds off a map, rounding them into a
 * URL, and comparing what came back — not for near-misses. A pin genuinely outside the box is out by
 * whole degrees, because the only way to produce one is to have swapped an axis.
 */
export function containsPoint(
  viewport: Viewport,
  latitude: number,
  longitude: number,
  tolerance = 1e-6,
): boolean {
  return (
    latitude >= viewport.minLatitude - tolerance &&
    latitude <= viewport.maxLatitude + tolerance &&
    longitude >= viewport.minLongitude - tolerance &&
    longitude <= viewport.maxLongitude + tolerance
  )
}
