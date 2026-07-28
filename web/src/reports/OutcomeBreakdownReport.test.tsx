import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readReportUrlState } from './reportUrlState'
import type { OutcomeBreakdown } from '../api/contract'
import { OutcomeBreakdownReport } from './OutcomeBreakdownReport'

const fetchOutcomeBreakdown = vi.hoisted(() => vi.fn())
const fetchFilterOptions = vi.hoisted(() => vi.fn())

const onChange = vi.fn()

/** What the address bar asked for. Defaults, unless a test says otherwise. */
const urlState = readReportUrlState('')

vi.mock('../api/client', () => ({ fetchOutcomeBreakdown, fetchFilterOptions }))

function row(group: string, poor: number, inspected: number, observed: number, supported: number) {
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

// The measured cuisine figures from ADR-0007.
const breakdown: OutcomeBreakdown = {
  dimension: 'Cuisine',
  rows: [
    row('Basque', 1, 2, 0.5, 0.0945),
    row('Latin American', 12, 795, 0.0151, 0.0087),
    row('Pakistani', 1, 31, 0.0323, 0.0057),
  ],
  ungroupedEstablishments: 3605,
  hasDateRange: false,
}

beforeEach(() => {
  onChange.mockClear()
  fetchOutcomeBreakdown.mockReset()
  fetchOutcomeBreakdown.mockResolvedValue(breakdown)
  fetchFilterOptions.mockReset()
  fetchFilterOptions.mockResolvedValue({
    cuisines: ['American', 'Basque'],
    localities: ['Manhattan', 'Queens'],
    localityBounds: [],
  })
})

describe('OutcomeBreakdownReport', () => {
  it('shows a row per group with its counts', async () => {
    render(<OutcomeBreakdownReport initial={urlState} onChange={onChange} />)

    expect(await screen.findByRole('row', { name: /Latin American/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Pakistani/ })).toBeInTheDocument()
  })

  /**
   * ADR-0007's first decision, and the measurement showed it is the load-bearing one rather than
   * good practice: sorted by what the evidence supports, the top of the cuisine table is still a
   * group of two. `n` beside the rate is how a reader can tell.
   */
  it('shows the sample size in the same row as the rate', async () => {
    render(<OutcomeBreakdownReport initial={urlState} onChange={onChange} />)

    const basque = await screen.findByRole('row', { name: /Basque/ })
    const cells = within(basque).getAllByRole('cell')

    // By position rather than by text: "2" is both the total and the inspected count on this row,
    // and a text query cannot say which one it found.
    expect(cells[1]).toHaveTextContent('2') // Inspected (n)
    expect(cells[9]).toHaveTextContent('50.00%') // Poor %
    expect(cells[10]).toHaveTextContent('9.45%') // Supported ≥
  })

  /** The interface must not present the first row as a verdict. */
  it('warns in the table itself that a small group can sit at the top', async () => {
    render(<OutcomeBreakdownReport initial={urlState} onChange={onChange} />)

    await screen.findByRole('row', { name: /Basque/ })

    expect(
      screen.getByText(/A group with few inspected establishments can still appear near the top/i),
    ).toBeInTheDocument()
  })

  /**
   * A reader who cannot see the arrow still needs to know which column decides the order.
   */
  it('announces which column is sorted', async () => {
    render(<OutcomeBreakdownReport initial={urlState} onChange={onChange} />)

    await screen.findByRole('row', { name: /Basque/ })

    expect(screen.getByRole('columnheader', { name: /Supported/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    expect(screen.getByRole('columnheader', { name: /Poor %/ })).toHaveAttribute(
      'aria-sort',
      'none',
    )
  })

  it('re-sorts when a column header is activated', async () => {
    const user = userEvent.setup()

    render(<OutcomeBreakdownReport initial={urlState} onChange={onChange} />)
    await screen.findByRole('row', { name: /Basque/ })

    await user.click(screen.getByRole('button', { name: /Poor %/ }))

    expect(screen.getByRole('columnheader', { name: /Poor %/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
  })

  /**
   * The gap between the table's totals and the dataset's. Not showing it invites a reader to conclude
   * the report has lost 3,605 establishments.
   */
  it('says how many establishments are in no row at all', async () => {
    render(<OutcomeBreakdownReport initial={urlState} onChange={onChange} />)

    expect(await screen.findByText(/3,605 establishments are not in any row/)).toBeInTheDocument()
  })

  /**
   * Refused here as well as by the API, so the user is told immediately instead of after a round trip
   * that spends one of the report budget's tokens.
   */
  it('refuses a backwards date range without asking the API', async () => {
    render(<OutcomeBreakdownReport initial={urlState} onChange={onChange} />)
    await screen.findByRole('row', { name: /Basque/ })

    // fireEvent rather than userEvent.type: typing into a date input commits a value per keystroke,
    // and each valid intermediate state is a legitimate request. What is being tested is the
    // completed backwards range, not the states passed through on the way to it.
    fireEvent.change(screen.getByLabelText(/inspected from/i), { target: { value: '2026-01-01' } })
    await screen.findByRole('row', { name: /Basque/ })

    const callsBefore = fetchOutcomeBreakdown.mock.calls.length

    fireEvent.change(screen.getByLabelText(/inspected to/i), { target: { value: '2025-01-01' } })

    expect(await screen.findByRole('alert')).toHaveTextContent(/after the .to. date/i)
    expect(fetchOutcomeBreakdown.mock.calls.length).toBe(callsBefore)

    // And the table still shows what it showed, rather than quietly reloading as the unfiltered
    // report underneath an error message about the range.
    expect(screen.getByRole('row', { name: /Basque/ })).toBeInTheDocument()
  })

  it("reports the API's own sentence when the report cannot be run", async () => {
    fetchOutcomeBreakdown.mockRejectedValue(new Error('This API allows 10 report requests every 60 seconds.'))

    render(<OutcomeBreakdownReport initial={urlState} onChange={onChange} />)

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('10 report requests every 60 seconds')
  })

  it('cannot export a report that has not loaded', () => {
    fetchOutcomeBreakdown.mockReturnValue(new Promise(() => {}))

    render(<OutcomeBreakdownReport initial={urlState} onChange={onChange} />)

    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled()
  })
})
