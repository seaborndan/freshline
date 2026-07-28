/**
 * Turning pins into what MapLibre draws.
 *
 * **This file is where the coordinate order changes.** The API returns `latitude` and `longitude` as
 * named fields precisely so the order cannot be got wrong in transit; GeoJSON positions are
 * `[longitude, latitude]`, longitude first. That conversion happens here, once, on one line, with a
 * test asserting it — rather than at every call site, where it would eventually be written the other
 * way round by someone reading the field order of the type.
 *
 * A swap throws nothing. It puts every restaurant in New York into the Indian Ocean, and the map
 * renders happily with no pins on screen.
 *
 * The counterpart check is in `api/validate.ts`, which refuses a response whose pins fall outside the
 * viewport that was requested — the only automated way to catch a swap in a city where both numbers
 * are legal values for the other axis.
 */

import type { MapEstablishment } from '../api/contract'
import { isClosed, pinStateOf, type PinState } from './pinStyle'

/**
 * What each feature carries. Kept to what the layer paints with plus what a click needs — every
 * property is copied for every pin on every update, and there can be a thousand of them.
 */
export interface PinProperties {
  id: number
  name: string
  state: PinState
  closed: boolean
}

export interface PinFeature {
  type: 'Feature'
  id: number
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: PinProperties
}

export interface PinFeatureCollection {
  type: 'FeatureCollection'
  features: PinFeature[]
}

/**
 * How many dots a person can actually count on the map.
 *
 * **Not the same number as the establishment count, and the gap is large.** New York geocodes many
 * establishments to the same address: in the opening viewport, 518 establishments occupy 306
 * distinct points, 75 points carry more than one, and a single address on Broadway carries 49. Those
 * pins are drawn exactly on top of each other, so 212 of them are invisible.
 *
 * This exists because the page said "518 places" over a map showing about three hundred dots, which
 * invites a reader to count them and conclude the map is broken. Naming both numbers is the honest
 * fix; hiding one of them is not.
 */
export function distinctPointCount(establishments: readonly MapEstablishment[]): number {
  // Exact coordinate equality, deliberately, because that is what stacking is: the source published
  // the identical geocode for several establishments. Rounding to a tolerance would merge
  // neighbouring restaurants that genuinely are drawn as separate dots.
  return new Set(
    establishments.map((establishment) => `${establishment.latitude},${establishment.longitude}`),
  ).size
}

export function toFeatureCollection(
  establishments: readonly MapEstablishment[],
): PinFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: establishments.map((establishment) => ({
      type: 'Feature',
      // The feature id, so a click can be tied back to an establishment without a lookup table.
      id: establishment.id,
      geometry: {
        type: 'Point',
        // Longitude first. See the note at the top of this file.
        coordinates: [establishment.longitude, establishment.latitude],
      },
      properties: {
        id: establishment.id,
        name: establishment.name,
        state: pinStateOf(establishment),
        closed: isClosed(establishment),
      },
    })),
  }
}
