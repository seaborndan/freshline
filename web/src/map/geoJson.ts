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
import { dominantState, isClosed, pinStateOf, type PinState } from './pinStyle'

/**
 * What each feature carries. Kept to what the layer paints with plus what a click needs — every
 * property is copied for every feature on every update.
 *
 * **One feature per point, not per establishment.** New York geocodes many establishments to the
 * same address, and drawing them as separate features meant painting circles that were exactly
 * covered by other circles: in the opening viewport, 518 features for 306 visible dots, so 212 of
 * them were pure cost. Aggregating removes that work and makes the stack something the map can say
 * out loud rather than something it hides.
 */
export interface PinProperties {
  /**
   * Every establishment at this point, newline-separated.
   *
   * A string because GeoJSON feature properties reach MapLibre expressions as primitives — an array
   * survives the round trip as data but cannot be indexed by a style expression, and the click
   * handler is the only thing that reads this. Newline rather than comma because no id contains one.
   */
  ids: string

  /** How many establishments are here. What the radius scales on, and what the dot labels itself. */
  count: number

  /** The name shown when this point holds exactly one establishment. */
  name: string

  /** The state carrying the most weight here — see `dominantState`. */
  state: PinState

  /** True when *any* establishment here was closed by the authority. */
  closed: boolean
}

export interface PinFeature {
  type: 'Feature'

  /**
   * A stable identity for this point.
   *
   * Needed for `setFeatureState`, which is how hover is expressed without rebuilding the source on
   * every mouse move. It is the point's own index in this collection rather than an establishment
   * id, because a feature is now a place on the map rather than a business.
   */
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

/**
 * One feature per coordinate, carrying everything stacked there.
 *
 * Insertion order is preserved, so a re-render of the same response produces the same features in
 * the same order — which matters because the feature id is a position in this list, and a hover
 * state keyed on a shifting id would light up the wrong dot.
 */
export function toFeatureCollection(
  establishments: readonly MapEstablishment[],
): PinFeatureCollection {
  const byPoint = new Map<string, MapEstablishment[]>()

  for (const establishment of establishments) {
    // Exact coordinate equality, deliberately — the same reasoning as distinctPointCount. Rounding
    // to a tolerance would merge neighbouring restaurants that genuinely draw as separate dots.
    const key = `${establishment.latitude},${establishment.longitude}`
    const existing = byPoint.get(key)

    if (existing === undefined) {
      byPoint.set(key, [establishment])
    } else {
      existing.push(establishment)
    }
  }

  return {
    type: 'FeatureCollection',
    features: [...byPoint.values()].map((atPoint, index) => {
      const first = atPoint[0]

      return {
        type: 'Feature' as const,
        id: index,
        geometry: {
          type: 'Point' as const,
          // Longitude first. See the note at the top of this file.
          coordinates: [first.longitude, first.latitude] as [number, number],
        },
        properties: {
          ids: atPoint.map((establishment) => establishment.id).join(idSeparator),
          count: atPoint.length,
          name: first.name,
          state: dominantState(atPoint.map(pinStateOf)),

          // Any closure here, not the first one's. A point holding one closed establishment among
          // five is a point where something was closed, and the ring says so.
          closed: atPoint.some(isClosed),
        },
      }
    }),
  }
}

/**
 * What separates packed ids.
 *
 * A newline, because no decimal id contains one — a comma would too, but a newline makes a malformed
 * value obvious the moment anybody logs it.
 */
const idSeparator = '\n'

/** The establishment ids a feature stands for. The inverse of how `ids` is packed above. */
export function idsOf(properties: Pick<PinProperties, 'ids'>): number[] {
  return properties.ids
    .split(idSeparator)
    .filter((entry) => entry !== '')
    .map(Number)
}
