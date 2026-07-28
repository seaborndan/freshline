import { describe, expect, it } from 'vitest'
import type { MapEstablishment } from '../api/contract'
import { distinctPointCount, idsOf, toFeatureCollection } from './geoJson'

const timesSquare: MapEstablishment = {
  id: 1328,
  name: 'RAISING CANES #888',
  latitude: 40.7570962405,
  longitude: -73.986193424352,
  isAwaitingFirstInspection: false,
  latestInspection: {
    inspectedOn: '2025-11-20',
    rawGrade: 'A',
    outcome: 'Good',
    normalisedSeverity: 9,
    closedByAuthority: false,
  },
}

describe('toFeatureCollection', () => {
  // The whole reason this module exists. GeoJSON is [longitude, latitude]; the API's fields are
  // named so the order cannot be got wrong in transit, and this is where it is imposed.
  //
  // Asserted as an ordered pair rather than by index, so the failure message shows both numbers —
  // and note that neither is out of range on its own, which is why nothing throws when it is wrong.
  it('puts longitude first, as GeoJSON requires', () => {
    const [feature] = toFeatureCollection([timesSquare]).features

    expect(feature.geometry.coordinates).toEqual([-73.986193424352, 40.7570962405])
  })

  it('does not put the restaurant in the Indian Ocean', () => {
    const [longitude, latitude] = toFeatureCollection([timesSquare]).features[0].geometry.coordinates

    expect(longitude).toBeLessThan(0)
    expect(latitude).toBeGreaterThan(0)
  })

  it('carries the state the layer paints from', () => {
    const [feature] = toFeatureCollection([timesSquare]).features

    expect(feature.properties.state).toBe('Good')
    expect(feature.properties.closed).toBe(false)
    expect(feature.properties.name).toBe('RAISING CANES #888')
  })

  it('marks a never-inspected establishment as its own state, not as an outcome', () => {
    const neverInspected: MapEstablishment = {
      ...timesSquare,
      isAwaitingFirstInspection: true,
      latestInspection: null,
    }

    expect(toFeatureCollection([neverInspected]).features[0].properties.state).toBe('NeverInspected')
  })

  it('carries a closure without changing the state it applies to', () => {
    const closed: MapEstablishment = {
      ...timesSquare,
      latestInspection: {
        inspectedOn: '2026-03-09',
        rawGrade: null,
        outcome: 'Ungraded',
        normalisedSeverity: 75,
        closedByAuthority: true,
      },
    }

    const { properties } = toFeatureCollection([closed]).features[0]

    expect(properties.closed).toBe(true)
    expect(properties.state).toBe('Ungraded')
  })

  /**
   * A feature is a point now, not an establishment, so it carries every id stacked on it rather than
   * one. The feature's own id is its position in the collection — what `setFeatureState` needs for
   * hover, and meaningless as a business identity.
   */
  it('carries the establishments at a point, so a click needs no lookup table', () => {
    const [feature] = toFeatureCollection([timesSquare]).features

    expect(idsOf(feature.properties)).toEqual([1328])
    expect(feature.properties.count).toBe(1)
  })

  /**
   * The change that made the map cheaper as well as more informative.
   *
   * Stacked establishments used to be separate features drawn exactly on top of each other — 518
   * features for 306 visible dots in the opening viewport, so 212 circles were painted under
   * something opaque. One feature per coordinate removes that work.
   */
  it('draws one feature per point rather than one per establishment', () => {
    const neighbour: MapEstablishment = { ...timesSquare, id: 2, name: 'NEXT DOOR' }
    const elsewhere: MapEstablishment = { ...timesSquare, id: 3, latitude: 40.75 }

    const { features } = toFeatureCollection([timesSquare, neighbour, elsewhere])

    expect(features).toHaveLength(2)
    expect(idsOf(features[0].properties)).toEqual([1328, 2])
    expect(features[0].properties.count).toBe(2)
    expect(idsOf(features[1].properties)).toEqual([3])
  })

  /**
   * What a stacked point is allowed to claim.
   *
   * The colour used to be whichever establishment the source handed over last — arbitrary, and
   * different between two runs of the same query. It is now the most severe state present, so a
   * point containing a Poor cannot look Good. See `mostSevereState` for why an unknown state never
   * outranks a known one.
   */
  it('shows the most severe state at a stacked point', () => {
    const poor: MapEstablishment = {
      ...timesSquare,
      id: 2,
      latestInspection: { ...timesSquare.latestInspection!, outcome: 'Poor' },
    }

    const [feature] = toFeatureCollection([timesSquare, poor]).features

    expect(feature.properties.state).toBe('Poor')
  })

  /** An unknown state must not outrank a known one — one ungraded among good is not bad news. */
  it('does not let an ungraded establishment override a good one', () => {
    const ungraded: MapEstablishment = {
      ...timesSquare,
      id: 2,
      latestInspection: { ...timesSquare.latestInspection!, outcome: 'Ungraded' },
    }

    const [feature] = toFeatureCollection([timesSquare, ungraded]).features

    expect(feature.properties.state).toBe('Good')
  })

  /** A closure anywhere at a point is a closure at that point — the ring is not the first one's. */
  it('marks a point closed when any establishment on it was closed', () => {
    const closed: MapEstablishment = {
      ...timesSquare,
      id: 2,
      latestInspection: { ...timesSquare.latestInspection!, closedByAuthority: true },
    }

    const [feature] = toFeatureCollection([timesSquare, closed]).features

    expect(feature.properties.closed).toBe(true)
  })

  /**
   * The feature id is a position, and `setFeatureState` keys hover on it. If the order changed
   * between renders of the same response, a hovered dot would hand its highlight to a different one.
   */
  it('numbers points in a stable order', () => {
    const elsewhere: MapEstablishment = { ...timesSquare, id: 3, latitude: 40.75 }
    const input = [timesSquare, elsewhere]

    expect(toFeatureCollection(input).features.map((feature) => feature.id)).toEqual(
      toFeatureCollection(input).features.map((feature) => feature.id),
    )
    expect(toFeatureCollection(input).features.map((feature) => feature.id)).toEqual([0, 1])
  })
})

describe('distinctPointCount', () => {
  // The number a reader can actually count on screen, which is not the number of establishments.
  // New York geocodes many of them to the same address: in the opening viewport 518 establishments
  // occupy 306 points, and one address on Broadway carries 49 of them.
  it('counts stacked establishments as one dot', () => {
    const sameAddress: MapEstablishment = { ...timesSquare, id: 9999, name: 'ANOTHER TENANT' }

    expect(distinctPointCount([timesSquare, sameAddress])).toBe(1)
  })

  it('counts establishments at different addresses separately', () => {
    const elsewhere: MapEstablishment = { ...timesSquare, id: 9999, latitude: 40.7581 }

    expect(distinctPointCount([timesSquare, elsewhere])).toBe(2)
  })

  // Not a tolerance. Two restaurants a few metres apart are drawn as two dots and must be counted
  // as two; only an identical published geocode is a stack.
  it('does not merge neighbours that are merely close', () => {
    const nextDoor: MapEstablishment = { ...timesSquare, id: 9999, latitude: 40.75709624051 }

    expect(distinctPointCount([timesSquare, nextDoor])).toBe(2)
  })

  it('is zero for an empty viewport', () => {
    expect(distinctPointCount([])).toBe(0)
  })
})
