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

import { useState } from 'react'
import { EstablishmentsReport } from './EstablishmentsReport'
import { OutcomeBreakdownReport } from './OutcomeBreakdownReport'

type ReportName = 'outcome-breakdown' | 'establishments'

const reports: { name: ReportName; label: string; question: string }[] = [
  {
    name: 'outcome-breakdown',
    label: 'Outcome breakdown',
    question: 'How do inspection results distribute across boroughs or cuisines?',
  },
  {
    name: 'establishments',
    label: 'Establishments',
    question: 'Which establishments, and what was their latest result?',
  },
]

export function ReportsPage() {
  const [report, setReport] = useState<ReportName>('outcome-breakdown')

  const current = reports.find((entry) => entry.name === report) ?? reports[0]

  return (
    <div className="reports">
      <header className="reports-header">
        <h1>Reports</h1>

        {/* Radios rather than a dropdown: there are two, both are worth seeing without a click, and
            each carries the question it answers — which is the part that tells somebody which one
            they want. A select would hide the second option behind an interaction. */}
        <fieldset className="reports-picker">
          <legend>Report</legend>

          {reports.map((entry) => (
            <label key={entry.name}>
              <input
                type="radio"
                name="report"
                value={entry.name}
                checked={report === entry.name}
                onChange={() => setReport(entry.name)}
              />
              <span>
                <strong>{entry.label}</strong>
                <span className="reports-question">{entry.question}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </header>

      {/*
        Keyed on the report name, so switching remounts rather than reusing the previous component's
        state. Without it a filter left set on one report would silently apply to the other — and
        "borough: Queens" means something different beside a table of boroughs than beside a table of
        establishments.
      */}
      {current.name === 'outcome-breakdown' ? (
        <OutcomeBreakdownReport key="outcome-breakdown" />
      ) : (
        <EstablishmentsReport key="establishments" />
      )}
    </div>
  )
}
