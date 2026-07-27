import { describe, expect, it } from 'vitest'
import type { MapEstablishment } from '../api/contract'
import { toFeatureCollection } from './geoJson'

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
