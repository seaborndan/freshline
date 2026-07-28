import { describe, expect, it } from 'vitest'
import type { OutcomeBreakdownRow } from '../api/contract'
import { defaultSort, nextSort, sortRows } from './sorting'

/** A row carrying only what the sort reads. */
function row(
  group: string,
  poor: number,
  inspected: number,
  observed: number,
  supported: number,
): OutcomeBreakdownRow {
  return {
    group,
    total: inspected,
    neverInspected: 0,
    noInspectionInPeriod: 0,
    good: inspected - poor,
    fair: 0,
    poor,
    ungraded: 0,
    pendingReinspection: 0,
    inspected,
    poorShare: { count: poor, total: inspected, observed, supportedAtLeast: supported },
  }
}

// The measured cuisine data from ADR-0007: the two orderings disagree, and the disagreement is the
// entire reason the supported floor exists.
const basque = row('Basque', 1, 2, 0.5, 0.0945)
const latinAmerican = row('Latin American', 12, 795, 0.0151, 0.0087)
const pakistani = row('Pakistani', 1, 31, 0.0323, 0.0057)

describe('sortRows', () => {
  it('opens on the supported floor, worst first', () => {
    expect(defaultSort).toEqual({ column: 'supported', direction: 'descending' })
  })

  /**
   * The property ADR-0007 exists for, at the level the user meets it.
   *
   * By observed rate, Pakistani (n=31) outranks Latin American (n=795). By what the evidence
   * supports, it does not — and Latin American is the row somebody reading this report should be
   * looking at.
   */
  it('ranks a well-evidenced group above a thinly-evidenced one with a higher rate', () => {
    const sorted = sortRows([latinAmerican, pakistani], defaultSort)

    expect(sorted.map((entry) => entry.group)).toEqual(['Latin American', 'Pakistani'])
  })

  /**
   * And the naive order, which the user can still ask for.
   *
   * A column header that does not sort by its own column would be an interface lying about itself.
   * The defensible order is the default; this one is available and the `n` column is what makes it
   * readable.
   */
  it('gives the raw ranking when the percentage column is sorted', () => {
    const sorted = sortRows(
      [latinAmerican, pakistani],
      { column: 'observed', direction: 'descending' },
    )

    expect(sorted.map((entry) => entry.group)).toEqual(['Pakistani', 'Latin American'])
  })

  /**
   * The limit of the technique, measured and recorded in ADR-0007 rather than glossed: at n=2 with a
   * city-wide base rate near 0.5%, the supported floor is still the highest in the table. The
   * ordering makes small samples quieter, not absent.
   */
  it('does not pretend a group of two has been demoted out of the way', () => {
    const sorted = sortRows([latinAmerican, pakistani, basque], defaultSort)

    expect(sorted[0].group).toBe('Basque')
    expect(sorted[0].inspected).toBe(2)
  })

  it('sorts names alphabetically', () => {
    const sorted = sortRows([pakistani, basque, latinAmerican], {
      column: 'group',
      direction: 'ascending',
    })

    expect(sorted.map((entry) => entry.group)).toEqual(['Basque', 'Latin American', 'Pakistani'])
  })

  it('sorts counts numerically rather than as text', () => {
    const sorted = sortRows(
      [row('a', 0, 9, 0, 0), row('b', 0, 100, 0, 0)],
      { column: 'inspected', direction: 'descending' },
    )

    // '100' < '9' as strings, so a text sort would put a first.
    expect(sorted.map((entry) => entry.group)).toEqual(['b', 'a'])
  })

  /** Without a tiebreaker, equal values come back in whatever order the sort left them — which can
      differ between renders and makes the table appear to shuffle for no reason. */
  it('breaks ties on the group name so the order is total', () => {
    const zebra = row('Zebra', 1, 100, 0.01, 0.005)
    const alpha = row('Alpha', 1, 100, 0.01, 0.005)

    expect(sortRows([zebra, alpha], defaultSort).map((entry) => entry.group)).toEqual([
      'Alpha',
      'Zebra',
    ])
  })

  it('does not sort the array it was given', () => {
    const rows = [pakistani, latinAmerican]

    sortRows(rows, defaultSort)

    expect(rows.map((entry) => entry.group)).toEqual(['Pakistani', 'Latin American'])
  })
})

describe('nextSort', () => {
  it('reverses the column that is already sorted', () => {
    expect(nextSort({ column: 'poor', direction: 'descending' }, 'poor')).toEqual({
      column: 'poor',
      direction: 'ascending',
    })
  })

  // "Which group has the most" is the question a count column is there to answer.
  it('starts a numeric column at largest first', () => {
    expect(nextSort(defaultSort, 'poor').direction).toBe('descending')
  })

  it('starts the name column at A to Z', () => {
    expect(nextSort(defaultSort, 'group').direction).toBe('ascending')
  })
})
