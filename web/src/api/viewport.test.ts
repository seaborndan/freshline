import { describe, expect, it } from 'vitest'
import { containsPoint, viewportProblem, type Viewport } from './viewport'

/** The box that holds the whole dataset: 0.43° by 0.56°, measured 2026-07-26. */
const wholeCity: Viewport = {
  minLatitude: 40.49,
  maxLatitude: 40.92,
  minLongitude: -74.26,
  maxLongitude: -73.7,
}

describe('viewportProblem', () => {
  // This is the drift check. `maxViewportDegrees` is duplicated from the API, and the way that
  // duplication would hurt is the server tightening its limit while this file still believes the
  // whole city is askable. If this ever fails, the map cannot show New York.
  it('accepts the box that holds every establishment in the database', () => {
    expect(viewportProblem(wholeCity)).toBeNull()
  })

  it('refuses more than a degree on either axis, as the API does', () => {
    expect(
      viewportProblem({ ...wholeCity, maxLatitude: wholeCity.minLatitude + 1.5 }),
    ).toMatch(/at most 1 degrees/)

    expect(
      viewportProblem({ ...wholeCity, maxLongitude: wholeCity.minLongitude + 1.5 }),
    ).toMatch(/at most 1 degrees/)
  })

  // Inverted rather than merely empty: a swapped min and max returns nothing, which looks exactly
  // like a part of the city with no restaurants in it.
  it('refuses an inverted box instead of letting it come back empty', () => {
    expect(
      viewportProblem({ ...wholeCity, minLatitude: 40.92, maxLatitude: 40.49 }),
    ).toMatch(/must be less than/)
  })

  it('refuses a box outside the world', () => {
    expect(viewportProblem({ ...wholeCity, minLatitude: -900 })).toMatch(/between -90 and 90/)
  })

  it('refuses a bound that is not a number, which is what a hand-edited URL produces', () => {
    expect(viewportProblem({ ...wholeCity, minLatitude: Number.NaN })).toMatch(/finite number/)
  })
})

describe('containsPoint', () => {
  it('accepts a point inside', () => {
    expect(containsPoint(wholeCity, 40.7571, -73.9862)).toBe(true)
  })

  // The check that catches an axis swap. Note that neither number is out of range on its own:
  // -73.99 is a legal latitude and 40.75 a legal longitude, which is why range checking cannot
  // catch this and containment can.
  it('rejects the same point with its axes swapped', () => {
    expect(containsPoint(wholeCity, -73.9862, 40.7571)).toBe(false)
  })

  it('accepts a point on the boundary, within the rounding tolerance', () => {
    expect(containsPoint(wholeCity, 40.92, -73.7)).toBe(true)
    expect(containsPoint(wholeCity, 40.9200001, -73.6999999)).toBe(true)
  })
})
