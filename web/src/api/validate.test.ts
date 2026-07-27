import { describe, expect, it } from 'vitest'
import { ApiContractError } from './errors'
import { readEstablishmentDetail, readMapResult } from './validate'
import type { Viewport } from './viewport'
import detailFixture from './__fixtures__/establishment-detail.json'
import mapFixture from './__fixtures__/map-viewport.json'

/** Holds every pin in the fixture, which spans Staten Island to the Upper West Side. */
const requested: Viewport = {
  minLatitude: 40.6,
  maxLatitude: 40.8,
  minLongitude: -74.2,
  maxLongitude: -73.9,
}

/** A deep copy, so a test that corrupts one field does not corrupt the fixture for the next one. */
function mapBody(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(mapFixture))
}

function detailBody(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(detailFixture))
}

describe('readMapResult', () => {
  it('reads a response captured from the running API', () => {
    const result = readMapResult(mapBody(), requested)

    expect(result.items).toHaveLength(5)
    expect(result.isTruncated).toBe(false)
  })

  // The distinction the whole legend rests on. Both of these rows have no letter grade, and they
  // are not the same thing: NOA was inspected and no grade was published, PARTNERS COFFEE has
  // never been inspected at all. Together their states cover 42% of the map.
  it('keeps never-inspected apart from inspected-and-ungraded', () => {
    const items = readMapResult(mapBody(), requested).items

    const neverInspected = items.find((item) => item.name === 'PARTNERS COFFEE')
    expect(neverInspected?.latestInspection).toBeNull()
    expect(neverInspected?.isAwaitingFirstInspection).toBe(true)

    const ungraded = items.find((item) => item.name === 'NOA')
    expect(ungraded?.isAwaitingFirstInspection).toBe(false)
    expect(ungraded?.latestInspection?.outcome).toBe('Ungraded')
    expect(ungraded?.latestInspection?.rawGrade).toBeNull()
  })

  // Closure is orthogonal to the outcome scale, not a sixth value on it. POPEYES is the proof:
  // closed by the authority, no letter grade, and a severity of 75.
  it('reads a closure as a fact separate from the outcome', () => {
    const closed = readMapResult(mapBody(), requested).items.find((item) => item.id === 21)

    expect(closed?.latestInspection?.closedByAuthority).toBe(true)
    expect(closed?.latestInspection?.outcome).toBe('Ungraded')
    expect(closed?.latestInspection?.normalisedSeverity).toBe(75)
  })

  // The check that replaces generated types. A sixth outcome is the one API change the "add
  // optional fields" rule does not cover, and it would otherwise draw as whatever colour the
  // fallback branch happens to produce.
  it('refuses an outcome it has no colour for, naming the field and the value', () => {
    const body = mapBody()
    ;(body.items as Record<string, Record<string, unknown>>[])[0].latestInspection.outcome =
      'Excellent'

    expect(() => readMapResult(body, requested)).toThrow(ApiContractError)
    expect(() => readMapResult(body, requested)).toThrow(
      /items\[0\]\.latestInspection\.outcome.*"Excellent"/,
    )
  })

  // "outcome is serialised as a name, not a number" — a client that accepted 1 here would be one
  // enum reorder away from colouring every restaurant wrongly.
  it('refuses a numeric outcome', () => {
    const body = mapBody()
    ;(body.items as Record<string, Record<string, unknown>>[])[0].latestInspection.outcome = 1

    expect(() => readMapResult(body, requested)).toThrow(/expected a string, got number/)
  })

  // The axis-swap detector. Both numbers are individually legal — -73.99 is a valid latitude and
  // 40.75 a valid longitude — so nothing but containment in the requested box can catch this.
  it('refuses a pin outside the viewport that was asked for', () => {
    const body = mapBody()
    const pin = (body.items as Record<string, unknown>[])[0]
    const { latitude, longitude } = pin as { latitude: number; longitude: number }
    pin.latitude = longitude
    pin.longitude = latitude

    expect(() => readMapResult(body, requested)).toThrow(/outside the requested viewport/)
    expect(() => readMapResult(body, requested)).toThrow(/swapped/)
  })

  it('refuses a response where the two ways of saying "never inspected" disagree', () => {
    const body = mapBody()
    ;(body.items as Record<string, unknown>[])[2].isAwaitingFirstInspection = false

    expect(() => readMapResult(body, requested)).toThrow(/must agree/)
  })

  it('refuses a missing truncation flag rather than assuming false', () => {
    const body = mapBody()
    delete body.isTruncated

    expect(() => readMapResult(body, requested)).toThrow(/isTruncated: expected a boolean/)
  })

  it('refuses a date that is not a plain calendar date', () => {
    const body = mapBody()
    ;(body.items as Record<string, Record<string, unknown>>[])[0].latestInspection.inspectedOn =
      '2025-11-20T00:00:00Z'

    expect(() => readMapResult(body, requested)).toThrow(/expected a date as yyyy-mm-dd/)
  })

  it('accepts an empty viewport, which is a result and not an error', () => {
    expect(readMapResult({ items: [], isTruncated: false }, requested).items).toEqual([])
  })
})

describe('readEstablishmentDetail', () => {
  it('reads a response captured from the running API', () => {
    const detail = readEstablishmentDetail(detailBody())

    expect(detail.name).toBe('POPEYES')
    expect(detail.locality).toBe('Staten Island')
    expect(detail.inspections).toHaveLength(3)
  })

  it('reads the history newest first, with its violations', () => {
    const [latest, , oldest] = readEstablishmentDetail(detailBody()).inspections

    expect(latest.inspectedOn).toBe('2026-03-09')
    expect(latest.closedByAuthority).toBe(true)
    expect(latest.rawGrade).toBeNull()
    expect(latest.rawScore).toBe(75)
    expect(latest.violations[0].code).toBe('04L')

    expect(oldest.inspectedOn).toBe('2025-08-27')
    expect(oldest.outcome).toBe('Fair')
    expect(oldest.rawGrade).toBe('B')
  })

  it('keeps criticality as published, including the false ones', () => {
    const violations = readEstablishmentDetail(detailBody()).inspections[0].violations

    expect(violations.map((violation) => violation.isCritical)).toContain(true)
    expect(violations.map((violation) => violation.isCritical)).toContain(false)
  })

  // Null is a third state — the source published "Not Applicable" — and flattening it to false
  // would assert something the source never said. No violation in the captured fixture has one, so
  // it is injected here rather than claimed to have been observed.
  it('keeps a not-applicable criticality as null rather than flattening it to false', () => {
    const body = detailBody()
    const violations = (body.inspections as Record<string, Record<string, unknown>[]>[])[0]
      .violations
    violations[0].isCritical = null

    expect(readEstablishmentDetail(body).inspections[0].violations[0].isCritical).toBeNull()
  })

  it('refuses an establishment with one coordinate and not the other', () => {
    const body = detailBody()
    body.longitude = null

    expect(() => readEstablishmentDetail(body)).toThrow(/null together or present together/)
  })

  it('accepts an establishment with no coordinates at all, which 511 of them have', () => {
    const body = detailBody()
    body.latitude = null
    body.longitude = null

    expect(readEstablishmentDetail(body).latitude).toBeNull()
  })

  it('refuses an awaiting-first-inspection establishment that has inspections', () => {
    const body = detailBody()
    body.isAwaitingFirstInspection = true

    expect(() => readEstablishmentDetail(body)).toThrow(/must agree/)
  })
})
