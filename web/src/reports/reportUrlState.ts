/**
 * The reports page's state, in the address bar.
 *
 * ## Why this exists
 *
 * Reported: click an establishment from a report, press Back, and you land on the reports page as
 * though arriving for the first time — the report you chose, the filters you set and the column you
 * sorted by are all gone. That is because they lived in React state, and React state does not
 * survive a navigation.
 *
 * The map solved this in M5 and the reasoning is unchanged (`state/urlState.ts`): *a view worth
 * leaving is a view worth coming back to, and a URL is the only thing the browser preserves across
 * one.* It is also what makes a filtered report shareable, which it was not before.
 *
 * ## Two reports, overlapping parameters
 *
 * `locality`, `cuisine`, `from`, `to`, `sort` and `dir` mean the same thing in both reports and are
 * spelled the same way, so switching reports keeps the filters that still apply. `dimension` belongs
 * to the breakdown and `outcome`/`uninspected` to the establishments list; each report reads only
 * its own and ignores the rest.
 *
 * ## Nothing here is trusted
 *
 * A query string is user-editable text. Every value is checked against what it is allowed to be, and
 * an unusable one is dropped rather than made fatal — somebody following a link with one broken
 * parameter should get the rest of the report, not an error page.
 */

import { inspectionOutcomes, reportDimensions } from '../api/contract'
import type { InspectionOutcome, ReportDimension } from '../api/contract'
import { sortableColumns, establishmentSortColumns } from './sorting'
import type { SortColumn, SortDirection, EstablishmentSortColumn } from './sorting'

export type ReportName = 'outcome-breakdown' | 'establishments'

const reportNames: readonly ReportName[] = ['outcome-breakdown', 'establishments']

export interface ReportUrlState {
  report: ReportName

  /** Shared by both reports. */
  locality: string
  cuisine: string
  inspectedFrom: string
  inspectedTo: string

  /** The breakdown's own. */
  dimension: ReportDimension

  /** The establishments list's own. */
  outcome: InspectionOutcome | ''
  neverInspected: '' | 'true' | 'false'

  /** Whichever report is showing reads the sort with its own column list. */
  sort: string
  direction: SortDirection
}

/** A date the API will accept: `yyyy-mm-dd` and a real day. */
function readDate(value: string | null): string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return ''
  }

  /*
   * Rejects 2026-02-31, which matches the pattern and is not a day.
   *
   * By comparing the parts back, because **JavaScript does not refuse an impossible date** — it
   * rolls it over. `new Date('2026-02-31T00:00:00Z')` is 3 March, with no NaN and no error, so a
   * `Number.isNaN` check accepts it. Found by a test written to prove the opposite.
   *
   * `Date` is used only to ask this question and never to format anything — see `plainDate.ts` for
   * why formatting through it is a bug this project has already had.
   */
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))

  const isReal =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day

  return isReal ? value : ''
}

function readOneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

export function readReportUrlState(search: string): ReportUrlState {
  const params = new URLSearchParams(search)

  return {
    report: readOneOf(params.get('report'), reportNames, 'outcome-breakdown'),
    locality: params.get('locality') ?? '',
    cuisine: params.get('cuisine') ?? '',
    inspectedFrom: readDate(params.get('from')),
    inspectedTo: readDate(params.get('to')),
    dimension: readOneOf(params.get('dimension'), reportDimensions, 'Locality'),
    outcome: readOneOf(params.get('outcome'), [...inspectionOutcomes, '' as const], ''),
    neverInspected: readOneOf(params.get('uninspected'), ['true', 'false', ''] as const, ''),

    // Checked against both reports' column lists, because one URL serves either and the page that
    // reads it knows which of them applies.
    sort: readOneOf(
      params.get('sort'),
      [...sortableColumns, ...establishmentSortColumns] as readonly string[],
      '',
    ),
    direction: readOneOf(params.get('dir'), ['ascending', 'descending'] as const, 'descending'),
  }
}

/**
 * The query string for a state — `?` included, or empty when there is nothing to say.
 *
 * Only values that differ from the default are written, so an untouched report has a clean URL and
 * a shared one carries exactly what was changed. Written in a fixed order, so changing one filter
 * does not reshuffle the address bar.
 */
export function writeReportUrlState(state: ReportUrlState): string {
  const params = new URLSearchParams()

  if (state.report !== 'outcome-breakdown') {
    params.set('report', state.report)
  }

  if (state.report === 'outcome-breakdown' && state.dimension !== 'Locality') {
    params.set('dimension', state.dimension)
  }

  if (state.locality !== '') params.set('locality', state.locality)
  if (state.cuisine !== '') params.set('cuisine', state.cuisine)

  if (state.report === 'establishments') {
    if (state.outcome !== '') params.set('outcome', state.outcome)
    if (state.neverInspected !== '') params.set('uninspected', state.neverInspected)
  }

  if (state.inspectedFrom !== '') params.set('from', state.inspectedFrom)
  if (state.inspectedTo !== '') params.set('to', state.inspectedTo)

  if (state.sort !== '') {
    params.set('sort', state.sort)
    params.set('dir', state.direction)
  }

  const query = params.toString()

  return query === '' ? '' : `?${query}`
}

/** The sort a report should open on, or its own default when the URL names a column it does not have. */
export function sortFor<T extends string>(
  state: ReportUrlState,
  columns: readonly T[],
  fallback: { column: T; direction: SortDirection },
): { column: T; direction: SortDirection } {
  return (columns as readonly string[]).includes(state.sort)
    ? { column: state.sort as T, direction: state.direction }
    : fallback
}

export type { SortColumn, EstablishmentSortColumn }
