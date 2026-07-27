import { describe, expect, it } from 'vitest'
import { viewportOf } from './viewportOf'

/** LngLatBounds accessors are named by compass direction, not by axis. */
const bounds = {
  getBounds: () => ({
    getSouth: () => 40.752,
    getNorth: () => 40.76,
    getWest: () => -73.9908,
    getEast: () => -73.9802,
  }),
}

describe('viewportOf', () => {
  // The transposition this file exists to prevent. South and north are latitudes, west and east are
  // longitudes, and getting that backwards sends a legal-looking box off the coast of Somalia and
  // returns an empty map — which reads as an area with no restaurants in it.
  it('maps south and north to latitude, west and east to longitude', () => {
    expect(viewportOf(bounds)).toEqual({
      minLatitude: 40.752,
      maxLatitude: 40.76,
      minLongitude: -73.9908,
      maxLongitude: -73.9802,
    })
  })

  it('keeps latitudes in the latitude range and longitudes in the longitude range', () => {
    const viewport = viewportOf(bounds)

    // New York is the awkward case: -73.99 is a legal latitude and 40.75 a legal longitude, so a
    // range check alone would not catch a swap. This asserts the actual values, not their legality.
    expect(viewport.minLatitude).toBeGreaterThan(0)
    expect(viewport.minLongitude).toBeLessThan(0)
  })
})
