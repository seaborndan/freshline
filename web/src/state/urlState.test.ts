import { describe, expect, it } from 'vitest'
import type { Viewport } from '../api/viewport'
import { readUrlState, writeUrlState } from './urlState'

const timesSquare: Viewport = {
  minLatitude: 40.7555,
  maxLatitude: 40.7605,
  minLongitude: -73.99183,
  maxLongitude: -73.97918,
}

describe('readUrlState', () => {
  it('reads an empty query as no viewport and no filters', () => {
    expect(readUrlState('')).toEqual({ viewport: null, filters: {}, selectedId: null })
  })

  it('reads every filter', () => {
    const { filters } = readUrlState(
      '?name=DUNKIN&cuisine=Coffee%2FTea&locality=Brooklyn&outcome=Poor',
    )

    expect(filters).toEqual({
      nameContains: 'DUNKIN',
      cuisine: 'Coffee/Tea',
      locality: 'Brooklyn',
      outcome: 'Poor',
    })
  })

  // The query string is user-editable text on its way to an API that answers a bad enum with a 400.
  // One broken parameter should cost that parameter, not the page.
  it('drops an outcome that is not one of the five, keeping the rest', () => {
    const { filters } = readUrlState('?outcome=Banana&locality=Queens')

    expect(filters.outcome).toBeUndefined()
    expect(filters.locality).toBe('Queens')
  })

  it('reads the never-inspected flag only in the two spellings that mean something', () => {
    expect(readUrlState('?uninspected=true').filters.awaitingFirstInspection).toBe(true)
    expect(readUrlState('?uninspected=false').filters.awaitingFirstInspection).toBe(false)
    expect(readUrlState('?uninspected=yes').filters.awaitingFirstInspection).toBeUndefined()
  })

  it('reads a viewport from all four bounds', () => {
    expect(
      readUrlState('?minLat=40.7555&maxLat=40.7605&minLon=-73.99183&maxLon=-73.97918').viewport,
    ).toEqual(timesSquare)
  })

  it('ignores a partial viewport, because three bounds describe nothing', () => {
    expect(readUrlState('?minLat=40.7555&maxLat=40.7605&minLon=-73.99183').viewport).toBeNull()
  })

  // Falls back rather than failing: someone following a link with a broken box should get the
  // opening view, not an error page. These are the API's own rules, applied before the request.
  it('falls back when the viewport is one the API would refuse', () => {
    expect(readUrlState('?minLat=40&maxLat=42&minLon=-74&maxLon=-73').viewport).toBeNull()
    expect(
      readUrlState('?minLat=40.76&maxLat=40.75&minLon=-73.99&maxLon=-73.97').viewport,
    ).toBeNull()
    expect(readUrlState('?minLat=x&maxLat=40.76&minLon=-73.99&maxLon=-73.97').viewport).toBeNull()
  })

  it('keeps the filters even when the viewport is unusable', () => {
    expect(readUrlState('?minLat=40&maxLat=42&minLon=-74&maxLon=-73&locality=Bronx').filters)
      .toEqual({ locality: 'Bronx' })
  })
})

describe('writeUrlState', () => {
  it('writes nothing for an empty state', () => {
    expect(writeUrlState({ viewport: null, filters: {}, selectedId: null })).toBe('')
  })

  it('writes the bounds under the names the API uses, so the two can be compared', () => {
    const query = writeUrlState({ viewport: timesSquare, filters: {}, selectedId: null })

    expect(query).toContain('minLat=40.755500')
    expect(query).toContain('maxLon=-73.979180')
  })

  it('omits an empty name rather than writing name=', () => {
    expect(writeUrlState({ viewport: null, filters: { nameContains: '' }, selectedId: null })).toBe('')
  })

  // The round trip is what makes a link shareable: what comes out of the address bar has to be what
  // went into it, or the map somebody opens is not the map that was sent.
  it('round-trips a full state', () => {
    const state = {
      viewport: timesSquare,
      selectedId: 1328,
      filters: {
        nameContains: 'DUNKIN',
        cuisine: 'Coffee/Tea',
        locality: 'Brooklyn',
        outcome: 'Poor' as const,
        awaitingFirstInspection: false,
      },
    }

    expect(readUrlState(writeUrlState(state))).toEqual(state)
  })

  // Panning writes the URL on every settle. If the parameter order moved with it, the address bar
  // would reshuffle while the user dragged.
  it('writes parameters in a stable order', () => {
    const first = writeUrlState({ viewport: timesSquare, filters: { locality: 'Bronx' }, selectedId: null })
    const second = writeUrlState({ filters: { locality: 'Bronx' }, viewport: timesSquare, selectedId: null })

    expect(first).toBe(second)
  })

  // "Look at this restaurant" is a thing people send each other, and a link that reopens the map
  // but not the panel has lost the point of the message.
  it('carries the open establishment', () => {
    expect(readUrlState('?id=1328').selectedId).toBe(1328)
    expect(writeUrlState({ viewport: null, filters: {}, selectedId: 1328 })).toBe('?id=1328')
  })

  // An identity here is a positive integer. Both of these are a link somebody mangled, and neither
  // should reach the API to be told 404.
  it('ignores an id that is not one', () => {
    expect(readUrlState('?id=banana').selectedId).toBeNull()
    expect(readUrlState('?id=-1').selectedId).toBeNull()
    expect(readUrlState('?id=1.5').selectedId).toBeNull()
  })
})
