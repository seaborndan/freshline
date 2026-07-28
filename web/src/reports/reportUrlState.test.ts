import { describe, expect, it } from 'vitest'
import { readReportUrlState, sortFor, writeReportUrlState } from './reportUrlState'
import { defaultEstablishmentSort, establishmentSortColumns } from './sorting'

describe('readReportUrlState', () => {
  it('defaults to the breakdown, unfiltered', () => {
    const state = readReportUrlState('')

    expect(state.report).toBe('outcome-breakdown')
    expect(state.dimension).toBe('Locality')
    expect(state.locality).toBe('')
    expect(state.outcome).toBe('')
  })

  it('reads a report and its filters', () => {
    const state = readReportUrlState('?report=establishments&locality=Queens&outcome=Poor')

    expect(state.report).toBe('establishments')
    expect(state.locality).toBe('Queens')
    expect(state.outcome).toBe('Poor')
  })

  /**
   * A query string is user-editable text on its way to an API that answers a bad enum with a 400.
   * Somebody following a link with one broken parameter should get the rest of the report, not an
   * error page — the same stance `state/urlState.ts` takes for the map.
   */
  it('drops values that are not allowed rather than passing them on', () => {
    const state = readReportUrlState('?report=banana&outcome=Excellent&dimension=Postcode')

    expect(state.report).toBe('outcome-breakdown')
    expect(state.outcome).toBe('')
    expect(state.dimension).toBe('Locality')
  })

  /** A date that matches the shape and is not a day. 31 February passes a regex and is not a date. */
  it('rejects a date that looks right and does not exist', () => {
    expect(readReportUrlState('?from=2026-02-31').inspectedFrom).toBe('')
    expect(readReportUrlState('?from=2026-02-28').inspectedFrom).toBe('2026-02-28')
  })

  it('rejects a sort column neither report has', () => {
    expect(readReportUrlState('?sort=nonsense').sort).toBe('')
    expect(readReportUrlState('?sort=poor').sort).toBe('poor')
  })
})

describe('writeReportUrlState', () => {
  it('says nothing when nothing has been chosen', () => {
    expect(writeReportUrlState(readReportUrlState(''))).toBe('')
  })

  /** Only what differs from the default, so a shared URL carries exactly what was changed. */
  it('writes only what was changed', () => {
    const state = { ...readReportUrlState(''), locality: 'Queens' }

    expect(writeReportUrlState(state)).toBe('?locality=Queens')
  })

  /**
   * Round-trips, which is the property the whole module exists for: leave the page, come back, and
   * be where you were.
   */
  it('round-trips a filtered report', () => {
    const original = readReportUrlState(
      '?report=establishments&locality=Queens&outcome=Poor&from=2025-01-01&sort=rawScore&dir=ascending',
    )

    expect(readReportUrlState(writeReportUrlState(original))).toEqual(original)
  })

  /** A filter belonging to the other report is not written, so switching does not carry nonsense. */
  it('does not write the other report’s parameters', () => {
    const state = { ...readReportUrlState(''), report: 'outcome-breakdown' as const, outcome: 'Poor' as const }

    expect(writeReportUrlState(state)).not.toContain('outcome')
  })
})

describe('sortFor', () => {
  it('takes the sort when the report has that column', () => {
    const state = readReportUrlState('?sort=rawScore&dir=ascending')

    expect(sortFor(state, establishmentSortColumns, defaultEstablishmentSort)).toEqual({
      column: 'rawScore',
      direction: 'ascending',
    })
  })

  /** One URL serves either report, so a column the showing report does not have falls back. */
  it('falls back when the column belongs to the other report', () => {
    const state = readReportUrlState('?sort=supported&dir=descending')

    expect(sortFor(state, establishmentSortColumns, defaultEstablishmentSort)).toEqual(
      defaultEstablishmentSort,
    )
  })
})
