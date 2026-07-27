import { describe, expect, it } from 'vitest'
import type { MapEstablishment } from '../api/contract'
import { distinctPointCount, toFeatureCollection } from './geoJson'

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

  it('gives every feature the establishment id, so a click needs no lookup table', () => {
    expect(toFeatureCollection([timesSquare]).features[0].id).toBe(1328)
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
