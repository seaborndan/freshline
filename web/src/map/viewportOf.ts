/**
 * Reading the box a map is currently showing.
 *
 * **The coordinate-order trap, one last time.** MapLibre's `getBounds()` returns a `LngLatBounds`,
 * whose accessors are named by compass direction rather than by axis — `getWest()` is a longitude
 * and `getSouth()` is a latitude. Assigning them positionally, or assuming the first pair is
 * "min, min", is how a viewport ends up transposed. Every assignment below names both sides.
 *
 * A transposed viewport here would not throw. It would send a legal-looking bounding box off the
 * coast of Somalia and return an empty map, which looks exactly like an area with no restaurants.
 * `api/validate.ts` is the backstop: it refuses any response whose pins fall outside the box that
 * was requested.
 */

import type { Viewport } from '../api/viewport'

/** Just the part of a MapLibre map this needs, so a test can supply one without a GPU. */
export interface BoundsSource {
  getBounds(): {
    getSouth(): number
    getNorth(): number
    getWest(): number
    getEast(): number
  }
}

export function viewportOf(map: BoundsSource): Viewport {
  const bounds = map.getBounds()

  return {
    minLatitude: bounds.getSouth(),
    maxLatitude: bounds.getNorth(),
    minLongitude: bounds.getWest(),
    maxLongitude: bounds.getEast(),
  }
}
