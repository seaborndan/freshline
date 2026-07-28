/**
 * The reporting page: choose what to group by, narrow it, read the table, take it away.
 *
 * ## What this page is not
 *
 * It is not a query builder. Every control here narrows one named report that answers one question —
 * how do inspection results distribute across boroughs or cuisines? The reasoning for refusing a
 * generic builder is in `docs/milestones/m5b-landing-and-reporting.md`; the short version is that a
 * builder is the same artefact whatever data sits underneath it, and it hides everything specific and
 * interesting about this one.
 *
 * ## The thing this page is most likely to get wrong
 *
 * Presenting a ranking as a verdict. Sorted by what the evidence supports, the top of the cuisine
 * table is still a cuisine with two establishments in it — measured, and written up in ADR-0007. So
 * `n` sits beside every rate, and the page says in words that a small group at the top is a small
 * group rather than a finding.
 */

import { useMemo, useRef, useState } from 'react'
import type { OutcomeBreakdownRow, ReportDimension } from '../api/contract'
import { useFilterOptions } from '../filters/useFilterOptions'
import { toCsv, downloadCsv } from './csv'
import { defaultSort, nextSort, sortRows, type SortColumn, type SortState } from './sorting'
import { useOutcomeBreakdown } from './useOutcomeBreakdown'

/**
 * What this report is, in a sentence, rendered by the page beside the report picker.
 *
 * Exported rather than rendered here because it belongs *to* this report and is *placed* by the
 * shell — the picker and the description sit in one grid, and only the shell knows about that grid.
 * Keeping the text in this file means changing the report and changing its description are the same
 * edit.
 */
export const outcomeBreakdownDescription =
  'Every establishment counts once, under its most recent inspection result. Percentages are over ' +
  'establishments that have been inspected — never-inspected places are counted separately, ' +
  'because including them would make a borough with a large inspection backlog look better than ' +
  'one that has been visited.'

const dimensionLabels: Record<ReportDimension, string> = {
  Locality: 'Borough',
  Cuisine: 'Cuisine',
}

export function OutcomeBreakdownReport() {
  const options = useFilterOptions()

  const [dimension, setDimension] = useState<ReportDimension>('Locality')
  const [locality, setLocality] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [inspectedFrom, setInspectedFrom] = useState('')
  const [inspectedTo, setInspectedTo] = useState('')
  const [sort, setSort] = useState<SortState>(defaultSort)

  // A backwards range is refused by the API with a 400, and refusing it here as well means the user
  // is told immediately rather than after a round trip that spends a report token.
  const rangeIsBackwards =
    inspectedFrom !== '' && inspectedTo !== '' && inspectedFrom > inspectedTo

  /**
   * The request, frozen while the date range is invalid.
   *
   * Dropping the dates and asking anyway was the first attempt, and it is worse than it looks: the
   * table would quietly reload as the *unfiltered* report while an error message sat above it saying
   * the range was wrong. The user would be reading real numbers for a period they did not ask for.
   *
   * Holding the previous request means the table keeps showing what it was showing, the message
   * explains why it has not changed, and no report token is spent on a query nobody wants.
   */
  const request = useMemo(
    () => ({
      dimension,
      // Filtering by the same thing you are grouping by leaves one row, which is a legitimate thing
      // to ask for and not worth preventing.
      locality: locality === '' ? undefined : locality,
      cuisine: cuisine === '' ? undefined : cuisine,
      inspectedFrom: inspectedFrom === '' ? undefined : inspectedFrom,
      inspectedTo: inspectedTo === '' ? undefined : inspectedTo,
    }),
    [dimension, locality, cuisine, inspectedFrom, inspectedTo],
  )

  const lastValidRequest = useRef(request)

  if (!rangeIsBackwards) {
    lastValidRequest.current = request
  }

  const view = useOutcomeBreakdown(lastValidRequest.current)

  const rows = useMemo(
    () => (view.breakdown === null ? [] : sortRows(view.breakdown.rows, sort)),
    [view.breakdown, sort],
  )

  const describeFilters = () => {
    const parts: string[] = []

    if (locality !== '') parts.push(`borough: ${locality}`)
    if (cuisine !== '') parts.push(`cuisine: ${cuisine}`)
    if (inspectedFrom !== '') parts.push(`inspected from: ${inspectedFrom}`)
    if (inspectedTo !== '') parts.push(`inspected to: ${inspectedTo}`)

    return parts.length === 0 ? 'none' : parts.join('; ')
  }

  const exportCsv = () => {
    if (view.breakdown === null) {
      return
    }

    const csv = toCsv({
      // The context the numbers would otherwise lose the moment the file leaves this page.
      provenance: [
        `Freshline — inspection outcomes by ${dimensionLabels[dimension].toLowerCase()}`,
        `Filters: ${describeFilters()}`,
        `Rows: ${rows.length}`,
        `Establishments not grouped (no ${dimensionLabels[dimension].toLowerCase()} recorded): ${view.breakdown.ungroupedEstablishments}`,
        `Sorted by: ${sort.column} ${sort.direction}`,
        'Poor % is over inspected establishments, not all establishments.',
        '"Supported at least" is the lower bound of a 95% Wilson interval — see ADR-0007.',
        'Source: NYC Open Data (DOHMH). Not an official record.',
      ],
      header: [
        dimensionLabels[dimension],
        'Total',
        'Inspected',
        'Never inspected',
        'Not inspected in period',
        'Good',
        'Fair',
        'Poor',
        'Ungraded',
        'Pending reinspection',
        'Poor %',
        'Poor % supported at least',
      ],
      rows: rows.map((row) => [
        row.group,
        row.total,
        row.inspected,
        row.neverInspected,
        row.noInspectionInPeriod,
        row.good,
        row.fair,
        row.poor,
        row.ungraded,
        row.pendingReinspection,
        (row.poorShare.observed * 100).toFixed(2),
        (row.poorShare.supportedAtLeast * 100).toFixed(2),
      ]),
    })

    downloadCsv(`freshline-outcomes-by-${dimension.toLowerCase()}.csv`, csv)
  }

  return (
    <>
      <form className="reports-controls" onSubmit={(event) => event.preventDefault()}>
        <label>
          Group by
          <select
            value={dimension}
            onChange={(event) => setDimension(event.target.value as ReportDimension)}
          >
            <option value="Locality">Borough</option>
            <option value="Cuisine">Cuisine</option>
          </select>
        </label>

        <label>
          Borough
          <select
            value={locality}
            onChange={(event) => setLocality(event.target.value)}
            disabled={options === null}
          >
            <option value="">All boroughs</option>
            {options?.localities.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Cuisine
          <select
            value={cuisine}
            onChange={(event) => setCuisine(event.target.value)}
            disabled={options === null}
          >
            <option value="">All cuisines</option>
            {options?.cuisines.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Inspected from
          <input
            type="date"
            value={inspectedFrom}
            onChange={(event) => setInspectedFrom(event.target.value)}
          />
        </label>

        <label>
          Inspected to
          <input
            type="date"
            value={inspectedTo}
            onChange={(event) => setInspectedTo(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="reports-export"
          onClick={exportCsv}
          disabled={view.breakdown === null || rows.length === 0}
        >
          Export CSV
        </button>
      </form>

      {rangeIsBackwards ? (
        <p role="alert" className="reports-notice reports-notice-failure">
          The &ldquo;from&rdquo; date is after the &ldquo;to&rdquo; date, so no report was requested.
        </p>
      ) : null}

      {view.failure === null ? null : (
        <p role="alert" className="reports-notice reports-notice-failure">
          {view.failure}
          {view.retryAfterSeconds === null
            ? ''
            : ` Waiting ${view.retryAfterSeconds} seconds before asking again.`}
        </p>
      )}

      <Status view={view} rows={rows} dimension={dimension} />

      {view.breakdown === null ? null : (
        <BreakdownTable
          rows={rows}
          dimension={dimension}
          sort={sort}
          onSort={(column) => setSort((current) => nextSort(current, column))}
        />
      )}
    </>
  )
}

function Status({
  view,
  rows,
  dimension,
}: {
  view: ReturnType<typeof useOutcomeBreakdown>
  rows: OutcomeBreakdownRow[]
  dimension: ReportDimension
}) {
  if (view.breakdown === null) {
    return <p role="status">{view.isLoading ? 'Running the report…' : ''}</p>
  }

  if (rows.length === 0) {
    return <p role="status">Nothing matches these filters.</p>
  }

  const noun = dimension === 'Locality' ? 'boroughs' : 'cuisines'

  return (
    <p role="status" className="reports-status">
      {rows.length.toLocaleString('en-GB')} {noun}.{' '}
      {view.breakdown.ungroupedEstablishments > 0 ? (
        <>
          {view.breakdown.ungroupedEstablishments.toLocaleString('en-GB')} establishments are not in
          any row, because the source records no{' '}
          {dimension === 'Locality' ? 'borough' : 'cuisine'} for them.{' '}
        </>
      ) : null}
      {view.isLoading ? 'Updating…' : ''}
    </p>
  )
}

function BreakdownTable({
  rows,
  dimension,
  sort,
  onSort,
}: {
  rows: OutcomeBreakdownRow[]
  dimension: ReportDimension
  sort: SortState
  onSort: (column: SortColumn) => void
}) {
  const columns: { key: SortColumn; label: string; numeric: boolean }[] = [
    { key: 'group', label: dimensionLabels[dimension], numeric: false },
    { key: 'total', label: 'Total', numeric: true },
    { key: 'inspected', label: 'Inspected (n)', numeric: true },
    { key: 'neverInspected', label: 'Never inspected', numeric: true },
    { key: 'noInspectionInPeriod', label: 'Not in period', numeric: true },
    { key: 'good', label: 'Good', numeric: true },
    { key: 'fair', label: 'Fair', numeric: true },
    { key: 'poor', label: 'Poor', numeric: true },
    { key: 'ungraded', label: 'Ungraded', numeric: true },
    { key: 'pendingReinspection', label: 'Pending', numeric: true },
    { key: 'observed', label: 'Poor %', numeric: true },
    { key: 'supported', label: 'Supported ≥', numeric: true },
  ]

  return (
    <div className="reports-table-scroll">
      <table className="reports-table">
        <caption>
          Every row accounts for its own total: inspected + never inspected + not inspected in the
          selected period. Ordered by what the evidence supports, worst first &mdash; not by the
          observed percentage.
          A group with few inspected establishments can still appear near the top; the{' '}
          <strong>Inspected (n)</strong> column is how to tell. Sorting by{' '}
          <strong>Poor&nbsp;%</strong> gives the raw ranking, in which small groups dominate.
        </caption>

        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.numeric ? 'numeric' : undefined}
                // The sorted column and its direction, for anyone not reading the arrow.
                aria-sort={sort.column === column.key ? sort.direction : 'none'}
              >
                <button type="button" onClick={() => onSort(column.key)}>
                  {column.label}
                  <span aria-hidden="true">
                    {sort.column === column.key ? (sort.direction === 'ascending' ? ' ▲' : ' ▼') : ''}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.group}>
              <th scope="row">{row.group}</th>
              <td className="numeric">{row.total.toLocaleString('en-GB')}</td>
              <td className="numeric">{row.inspected.toLocaleString('en-GB')}</td>
              <td className="numeric">{row.neverInspected.toLocaleString('en-GB')}</td>
              <td className="numeric">{row.noInspectionInPeriod.toLocaleString('en-GB')}</td>
              <td className="numeric">{row.good.toLocaleString('en-GB')}</td>
              <td className="numeric">{row.fair.toLocaleString('en-GB')}</td>
              <td className="numeric">{row.poor.toLocaleString('en-GB')}</td>
              <td className="numeric">{row.ungraded.toLocaleString('en-GB')}</td>
              <td className="numeric">{row.pendingReinspection.toLocaleString('en-GB')}</td>
              <td className="numeric">{formatPercent(row.poorShare.observed)}</td>
              <td className="numeric supported">{formatPercent(row.poorShare.supportedAtLeast)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Two decimal places, because the rates here are small — the city-wide `Poor` rate is around 0.5%,
 * and rounding to whole percents would render most of this table as "0%".
 */
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}
