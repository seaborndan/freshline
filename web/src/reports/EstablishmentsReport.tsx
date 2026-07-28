/**
 * The row-level report: which establishments, with their latest result.
 *
 * The counterpart to the outcome breakdown. That one answers how results distribute across groups
 * and has no room for an establishment in it; this one is the drill-down that a reporting suite is
 * half-finished without.
 *
 * ## The distinction this table exists to preserve
 *
 * Two different things produce an empty result column, and merging them would be the easy mistake:
 *
 * - **Never inspected** — the city lists the place and has never visited it. A published state.
 * - **Not inspected in this period** — it has inspections, none inside the selected dates.
 *
 * Both are shown as themselves rather than as a blank cell or a shared "no data".
 */

import { useMemo, useRef, useState } from 'react'
import type { EstablishmentReportRow, InspectionOutcome } from '../api/contract'
import { inspectionOutcomes } from '../api/contract'
import { formatPlainDate } from '../api/plainDate'
import { useFilterOptions } from '../filters/useFilterOptions'
import { pinStyles } from '../map/pinStyle'
import { downloadCsv, toCsv } from './csv'
import {
  defaultEstablishmentSort,
  nextEstablishmentSort,
  sortEstablishmentRows,
  type EstablishmentSortColumn,
} from './sorting'
import type { Route } from '../routing/route'
import { pathFromRoute } from '../routing/route'
import { useEstablishmentReport } from './useEstablishmentReport'

/** What this report is, in a sentence. Placed by the page — see the note on the other report's. */
export const establishmentsDescription =
  'Every establishment matching the filters, with the result of its most recent counted ' +
  'inspection. A place with no inspection in the selected period is still listed — it is part of ' +
  'the answer to “what is here”, and dropping it would turn a list of establishments into a list ' +
  'of inspections.'

export interface EstablishmentsReportProps {
  onNavigate: (route: Route, search?: string) => void
}

export function EstablishmentsReport({ onNavigate }: EstablishmentsReportProps) {
  const options = useFilterOptions()

  const [locality, setLocality] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [outcome, setOutcome] = useState<InspectionOutcome | ''>('')
  const [neverInspected, setNeverInspected] = useState<'' | 'true' | 'false'>('')
  const [inspectedFrom, setInspectedFrom] = useState('')
  const [inspectedTo, setInspectedTo] = useState('')
  const [sort, setSort] = useState(defaultEstablishmentSort)

  const rangeIsBackwards =
    inspectedFrom !== '' && inspectedTo !== '' && inspectedFrom > inspectedTo

  const request = useMemo(
    () => ({
      locality: locality === '' ? undefined : locality,
      cuisine: cuisine === '' ? undefined : cuisine,
      outcome: outcome === '' ? undefined : outcome,
      awaitingFirstInspection: neverInspected === '' ? undefined : neverInspected === 'true',
      inspectedFrom: inspectedFrom === '' ? undefined : inspectedFrom,
      inspectedTo: inspectedTo === '' ? undefined : inspectedTo,
    }),
    [locality, cuisine, outcome, neverInspected, inspectedFrom, inspectedTo],
  )

  // Frozen while the range is invalid, so the table keeps showing what it was showing rather than
  // silently reloading as an unfiltered report underneath an error message. Same reasoning as the
  // breakdown, and the same bug it was written to fix.
  const lastValid = useRef(request)
  if (!rangeIsBackwards) {
    lastValid.current = request
  }

  const view = useEstablishmentReport(lastValid.current)

  const rows = useMemo(
    () => (view.report === null ? [] : sortEstablishmentRows(view.report.rows, sort)),
    [view.report, sort],
  )

  /**
   * The combination that cannot match anything, named before the API answers it with zero rows.
   *
   * An establishment with no inspections has no outcome, so asking for both is a contradiction. It
   * is answered honestly rather than refused — but "0 results" with no explanation reads as a bug in
   * the report rather than as a consequence of the question.
   */
  const contradictoryFilters = neverInspected === 'true' && outcome !== ''

  const exportCsv = () => {
    if (view.report === null) {
      return
    }

    const filters = [
      locality === '' ? null : `borough: ${locality}`,
      cuisine === '' ? null : `cuisine: ${cuisine}`,
      outcome === '' ? null : `outcome: ${outcome}`,
      neverInspected === '' ? null : `never inspected: ${neverInspected}`,
      inspectedFrom === '' ? null : `inspected from: ${inspectedFrom}`,
      inspectedTo === '' ? null : `inspected to: ${inspectedTo}`,
    ].filter((entry) => entry !== null)

    downloadCsv(
      'freshline-establishments.csv',
      toCsv({
        provenance: [
          'Freshline — establishments with their latest inspection result',
          `Filters: ${filters.length === 0 ? 'none' : filters.join('; ')}`,
          `Rows: ${rows.length}`,
          view.report.isTruncated
            ? 'TRUNCATED: more establishments matched than are listed here. Narrow the filters for a complete set.'
            : 'Complete: every matching establishment is listed.',
          'An empty result means either never inspected, or not inspected in the selected period — the two columns distinguish them.',
          'Source: NYC Open Data (DOHMH). Not an official record.',
        ],
        header: [
          'Name',
          'Address',
          'Borough',
          'Cuisine',
          'Result',
          'Inspected on',
          'Grade',
          'Score',
          'Phone',
          'Closed by authority',
          'Never inspected',
        ],
        rows: rows.map((row) => [
          row.name,
          row.addressLine ?? '',
          row.locality ?? '',
          row.cuisine ?? '',
          row.outcome ?? '',
          row.inspectedOn ?? '',
          row.rawGrade ?? '',
          row.rawScore ?? '',
          row.phone ?? '',
          row.closedByAuthority ? 'yes' : 'no',
          row.isAwaitingFirstInspection ? 'yes' : 'no',
        ]),
      }),
    )
  }

  return (
    <>
      <form className="reports-controls" onSubmit={(event) => event.preventDefault()}>
        <label>
          Borough
          <select value={locality} onChange={(e) => setLocality(e.target.value)} disabled={options === null}>
            <option value="">All boroughs</option>
            {options?.localities.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        <label>
          Cuisine
          <select value={cuisine} onChange={(e) => setCuisine(e.target.value)} disabled={options === null}>
            <option value="">All cuisines</option>
            {options?.cuisines.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        <label>
          Result
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as InspectionOutcome | '')}>
            <option value="">Any result</option>
            {inspectionOutcomes.map((value) => (
              <option key={value} value={value}>{pinStyles[value].label}</option>
            ))}
          </select>
        </label>

        <label>
          Never inspected
          <select
            value={neverInspected}
            onChange={(e) => setNeverInspected(e.target.value as '' | 'true' | 'false')}
          >
            <option value="">Include</option>
            <option value="true">Only these</option>
            <option value="false">Exclude</option>
          </select>
        </label>

        <label>
          Inspected from
          <input type="date" value={inspectedFrom} onChange={(e) => setInspectedFrom(e.target.value)} />
        </label>

        <label>
          Inspected to
          <input type="date" value={inspectedTo} onChange={(e) => setInspectedTo(e.target.value)} />
        </label>

        <button
          type="button"
          className="reports-export"
          onClick={exportCsv}
          disabled={view.report === null || rows.length === 0}
        >
          Export CSV
        </button>
      </form>

      {rangeIsBackwards ? (
        <p role="alert" className="reports-notice reports-notice-failure">
          The &ldquo;from&rdquo; date is after the &ldquo;to&rdquo; date, so no report was requested.
        </p>
      ) : null}

      {contradictoryFilters ? (
        <p role="status" className="reports-notice">
          Asking for a result <em>and</em> only never-inspected establishments cannot match anything:
          a place that has never been inspected has no result. Clear one of the two.
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

      <Status view={view} rows={rows} />

      {view.report === null ? null : (
        <EstablishmentTable
          rows={rows}
          sort={sort}
          onSort={(column) => setSort((current) => nextEstablishmentSort(current, column))}
          onNavigate={onNavigate}
        />
      )}
    </>
  )
}

function Status({
  view,
  rows,
}: {
  view: ReturnType<typeof useEstablishmentReport>
  rows: EstablishmentReportRow[]
}) {
  if (view.report === null) {
    return <p role="status">{view.isLoading ? 'Running the report…' : ''}</p>
  }

  if (rows.length === 0) {
    return <p role="status">No establishments match these filters.</p>
  }

  // "More than" is the strongest true claim available from a truncated result: which rows were
  // dropped is arbitrary, so the count describes what came back rather than what matched.
  return (
    <p role="status" className="reports-status">
      {view.report.isTruncated
        ? `More than ${rows.length.toLocaleString('en-GB')} establishments match — too many to list at once. Narrow the filters to see all of them.`
        : `${rows.length.toLocaleString('en-GB')} establishments.`}
      {view.isLoading ? ' Updating…' : ''}
    </p>
  )
}

function EstablishmentTable({
  rows,
  sort,
  onSort,
  onNavigate,
}: {
  rows: EstablishmentReportRow[]
  sort: { column: EstablishmentSortColumn; direction: 'ascending' | 'descending' }
  onSort: (column: EstablishmentSortColumn) => void
  onNavigate: (route: Route, search?: string) => void
}) {
  const columns: { key: EstablishmentSortColumn; label: string; numeric: boolean }[] = [
    { key: 'name', label: 'Establishment', numeric: false },
    { key: 'locality', label: 'Borough', numeric: false },
    { key: 'cuisine', label: 'Cuisine', numeric: false },
    { key: 'outcome', label: 'Result', numeric: false },
    { key: 'inspectedOn', label: 'Inspected', numeric: false },
    { key: 'rawScore', label: 'Score', numeric: true },
    { key: 'phone', label: 'Phone', numeric: false },
  ]

  return (
    <div className="reports-table-scroll">
      <table className="reports-table">
        <caption>
          Sorting by <strong>Result</strong> orders worst first rather than alphabetically, which is
          the only ordering that column is useful for. Establishments with no result sort last in
          both directions &mdash; an absence of information is not a value at one end of the scale.
        </caption>

        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.numeric ? 'numeric' : undefined}
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
            <tr key={row.id}>
              <th scope="row">
                {/*
                  A real anchor to the map, deep-linked at this establishment — the machinery for
                  which already exists: `?id=` frames the camera on it and opens its record.

                  An anchor rather than a button, so middle-click and "copy link address" work, and
                  so the row can be shared. The click is intercepted for ordinary left clicks only,
                  which keeps it a single-page navigation without taking the browser's own behaviour
                  away from anyone who asked for it.
                */}
                <a
                  className="reports-name"
                  href={`${pathFromRoute('map')}?id=${row.id}`}
                  onClick={(event) => {
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey ||
                      event.button !== 0
                    ) {
                      return
                    }

                    event.preventDefault()
                    onNavigate('map', `?id=${row.id}`)
                  }}
                >
                  {row.name}
                </a>
                {row.addressLine === null ? null : (
                  <span className="reports-address">{row.addressLine}</span>
                )}
              </th>
              <td>{row.locality ?? '—'}</td>
              <td>{row.cuisine ?? '—'}</td>
              <td>
                <Result row={row} />
              </td>
              <td>{row.inspectedOn === null ? '—' : formatPlainDate(row.inspectedOn)}</td>
              <td className="numeric">{row.rawScore ?? '—'}</td>
              <td>
                {/*
                  `tel:` because the source publishes a phone number and nothing else contactable —
                  no website, no email, checked across all 99,050 stored payloads. It is a real
                  digit string from the city rather than anything inferred, which is the only kind of
                  contact detail this project is willing to put on screen.
                */}
                {row.phone === null ? (
                  '—'
                ) : (
                  <a href={`tel:${row.phone}`}>{formatPhone(row.phone)}</a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The result cell, which has three states rather than two.
 *
 * A missing result is never rendered as a blank or a dash alone, because the two reasons for it mean
 * different things and a reader cannot recover which from an empty cell.
 */
function Result({ row }: { row: EstablishmentReportRow }) {
  if (row.outcome !== null) {
    const style = pinStyles[row.outcome]

    return (
      <span className="reports-result">
        <span
          className="legend-swatch"
          style={{ backgroundColor: style.fill, borderColor: style.stroke }}
          aria-hidden="true"
        />
        {style.label}
        {row.rawGrade === null ? null : <span className="reports-grade">Grade {row.rawGrade}</span>}
        {row.closedByAuthority ? <span className="reports-closed">Closed</span> : null}
      </span>
    )
  }

  return (
    <span className="reports-result reports-result-absent">
      {row.isAwaitingFirstInspection ? 'Never inspected' : 'Not in this period'}
    </span>
  )
}

/**
 * A ten-digit NYC number as `(212) 555-0100`.
 *
 * The source publishes digits with no punctuation. Anything that is not ten digits is shown exactly
 * as it arrived rather than forced into a shape it does not fit — the `tel:` link still works, and a
 * number reformatted into something the city did not publish would be this project inventing a
 * detail about a real business.
 */
function formatPhone(phone: string): string {
  if (!/^\d{10}$/.test(phone)) {
    return phone
  }

  return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`
}
