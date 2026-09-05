/**
 * The reporting page: pick a report, then narrow it.
 *
 * ## Two reports, and why that is the shape
 *
 * The request was a UI for running queries with arbitrary parameters. That is a small BI tool, and
 * it is the same artefact whether the data underneath is restaurant inspections or insurance claims
 * — see `docs/milestones/m5b-landing-and-reporting.md`. Named reports instead, each answering a
 * question somebody chose to ask.
 *
 * The two here are deliberately complementary, because the first one alone was half an answer:
 *
 * - **Outcome breakdown** — how results distribute across boroughs or cuisines. Rows are groups.
 * - **Establishments** — which places, with their latest result. Rows are establishments.
 *
 * A suite that can only aggregate cannot be drilled into, and a group-level CSV is far less useful
 * than a row-level one.
 */

import { useCallback, useRef, useState } from 'react'
import type { Route } from '../routing/route'
import { readReportUrlState, writeReportUrlState, type ReportUrlState } from './reportUrlState'
import { EstablishmentsReport, establishmentsDescription } from './EstablishmentsReport'
import { OutcomeBreakdownReport, outcomeBreakdownDescription } from './OutcomeBreakdownReport'

import type { ReportName } from './reportUrlState'

const reports: {
  name: ReportName
  label: string
  question: string
  description: string
}[] = [
  {
    name: 'outcome-breakdown',
    label: 'Outcome breakdown',
    question: 'How do inspection results distribute across boroughs or cuisines?',
    description: outcomeBreakdownDescription,
  },
  {
    name: 'establishments',
    label: 'Establishments',
    question: 'Which establishments, and what was their latest result?',
    description: establishmentsDescription,
  },
]

export interface ReportsPageProps {
  /** Passed down so a report row can send somebody to the map — see `EstablishmentsReport`. */
  onNavigate: (route: Route, search?: string) => void
}

export function ReportsPage({ onNavigate }: ReportsPageProps) {
  /**
   * Read once, at mount.
   *
   * The page is remounted whenever the route becomes `reports` — including on Back out of the map —
   * so mount is exactly when the address bar should be consulted. Re-reading it on every render
   * would fight the writes below.
   */
  const initial = useRef(readReportUrlState(window.location.search)).current

  const [report, setReport] = useState<ReportName>(initial.report)

  /**
   * The address bar follows the reports' own state.
   *
   * Held here rather than in each report, because the URL is one string and two components write to
   * it. `replaceState`, not `pushState`: a history entry per filter change would turn Back into an
   * undo-my-typing key, and what has to survive is the state at the moment somebody *leaves* — which
   * replaceState preserves exactly.
   */
  const urlState = useRef<ReportUrlState>(initial)

  const publish = useCallback((next: Partial<ReportUrlState>) => {
    urlState.current = { ...urlState.current, ...next }

    const query = writeReportUrlState(urlState.current)

    window.history.replaceState(null, '', `${window.location.pathname}${query}`)
  }, [])

  const chooseReport = useCallback(
    (name: ReportName) => {
      setReport(name)
      publish({ report: name })
    },
    [publish],
  )

  const current = reports.find((entry) => entry.name === report) ?? reports[0]

  return (
    <div className="reports">
      <header className="reports-header">
        <p className="eyebrow">THE CITY, IN CONTEXT</p>
        <h1>Reports</h1>

        {/*
          The picker and the chosen report's description, in one grid.

          The description used to be rendered by the report itself, below everything. Beside the
          picker it answers the question the picker raises — "what am I about to look at" — at the
          moment somebody is asking it, rather than after they have already chosen.

          Two columns, and the description is centred against the picker rather than aligned to its
          top: the picker is the taller element and an unaligned block of text beside it reads as
          having fallen out of the layout.
        */}
        <div className="reports-chooser">
          {/* Radios rather than a dropdown: there are two, both are worth seeing without a click,
              and each carries the question it answers — which is the part that tells somebody which
              one they want. A select would hide the second option behind an interaction.

              Stacked rather than side by side, so the two read as a list of choices rather than as a
              pair of buttons, and so a third report can be added without reflowing the row. */}
          <fieldset className="reports-picker">
            <legend>Report</legend>

            {reports.map((entry) => (
              <label key={entry.name}>
                <input
                  type="radio"
                  name="report"
                  value={entry.name}
                  checked={report === entry.name}
                  onChange={() => chooseReport(entry.name)}
                />
                <span>
                  <strong>{entry.label}</strong>
                  <span className="reports-question">{entry.question}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <p className="reports-lede">{current.description}</p>
        </div>
      </header>

      {/*
        Keyed on the report name, so switching remounts rather than reusing the previous component's
        state. Without it a filter left set on one report would silently apply to the other — and
        "borough: Queens" means something different beside a table of boroughs than beside a table of
        establishments.
      */}
      {current.name === 'outcome-breakdown' ? (
        <OutcomeBreakdownReport key="outcome-breakdown" initial={initial} onChange={publish} />
      ) : (
        <EstablishmentsReport
          key="establishments"
          initial={initial}
          onChange={publish}
          onNavigate={onNavigate}
        />
      )}
    </div>
  )
}
