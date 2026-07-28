/**
 * How a report table is ordered, and the one place ADR-0007 is enforced in the interface.
 *
 * ## The default is not the percentage column
 *
 * The API returns rows worst-first by `poorShare.supportedAtLeast` — the lower bound of a 95% Wilson
 * interval — rather than by the observed rate. Measured against the live data, that swaps three rows
 * of noise (groups of 31, 46 and 61 establishments) for three real signals (795, 1,736 and 541).
 *
 * ## A user can still sort by the percentage, and that is deliberate
 *
 * A column header that does not sort by its own column would be an interface lying about itself, and
 * that is a worse failure than the one being defended against. The defensible order is the default;
 * the naive order is available and clearly labelled. What the interface owes is that `n` is visible
 * in the same row, so somebody sorting by percentage can see that the top row has two establishments
 * in it.
 */

import type { OutcomeBreakdownRow } from '../api/contract'

export const sortableColumns = [
  'group',
  'total',
  'inspected',
  'neverInspected',
  'noInspectionInPeriod',
  'good',
  'fair',
  'poor',
  'ungraded',
  'pendingReinspection',
  'observed',
  'supported',
] as const

export type SortColumn = (typeof sortableColumns)[number]
export type SortDirection = 'ascending' | 'descending'

export interface SortState {
  column: SortColumn
  direction: SortDirection
}

/** What the API already returns, and what the table opens on. */
export const defaultSort: SortState = { column: 'supported', direction: 'descending' }

function valueOf(row: OutcomeBreakdownRow, column: SortColumn): string | number {
  switch (column) {
    case 'group':
      return row.group
    case 'observed':
      return row.poorShare.observed
    case 'supported':
      return row.poorShare.supportedAtLeast
    default:
      return row[column]
  }
}

/**
 * A new copy, sorted. Never sorts in place: the rows belong to the response, and mutating them would
 * make a re-render depend on how many times the table had previously been sorted.
 *
 * Ties break on the group name so the order is total. Without that, two groups with equal values
 * appear in whichever order the sort happened to leave them, which can differ between renders and
 * makes a table appear to shuffle for no reason.
 */
export function sortRows(rows: OutcomeBreakdownRow[], sort: SortState): OutcomeBreakdownRow[] {
  const factor = sort.direction === 'ascending' ? 1 : -1

  return [...rows].sort((left, right) => {
    const a = valueOf(left, sort.column)
    const b = valueOf(right, sort.column)

    if (a === b) {
      return left.group.localeCompare(right.group)
    }

    if (typeof a === 'string' || typeof b === 'string') {
      return factor * String(a).localeCompare(String(b))
    }

    return factor * (a - b)
  })
}

/**
 * What clicking a header does.
 *
 * Clicking the current column reverses it. Clicking a different one starts at the direction that
 * answers the question the column is usually asked: names read A–Z, numbers read largest-first,
 * because "which group has the most" is the question a count column is there to answer.
 */
export function nextSort(current: SortState, column: SortColumn): SortState {
  if (current.column === column) {
    return {
      column,
      direction: current.direction === 'descending' ? 'ascending' : 'descending',
    }
  }

  return { column, direction: column === 'group' ? 'ascending' : 'descending' }
}
