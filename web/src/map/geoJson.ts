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
