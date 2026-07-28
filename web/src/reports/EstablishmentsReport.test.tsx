import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EstablishmentReport } from '../api/contract'
import { EstablishmentsReport } from './EstablishmentsReport'

const fetchEstablishmentReport = vi.hoisted(() => vi.fn())
const fetchFilterOptions = vi.hoisted(() => vi.fn())

vi.mock('../api/client', () => ({ fetchEstablishmentReport, fetchFilterOptions }))

const report: EstablishmentReport = {
  rows: [
    {
      id: 1,
      name: 'ADDA GHOR',
      addressLine: '31-14 31ST AVENUE',
      locality: 'Queens',
      cuisine: 'Bangladeshi',
      isAwaitingFirstInspection: false,
      outcome: 'Poor',
      inspectedOn: '2026-02-21',
      rawGrade: 'C',
      rawScore: 29,
      closedByAuthority: false,
    },
    {
      id: 2,
      name: 'PARTNERS COFFEE',
      addressLine: '44 CHARLES STREET',
      locality: 'Manhattan',
      cuisine: null,
      isAwaitingFirstInspection: true,
      outcome: null,
      inspectedOn: null,
      rawGrade: null,
      rawScore: null,
      closedByAuthority: false,
    },
    {
      id: 3,
      name: 'QUIET DINER',
      addressLine: '1 ELSEWHERE ROAD',
      locality: 'Bronx',
      cuisine: 'American',
      // Has been inspected, just not inside the selected period.
      isAwaitingFirstInspection: false,
      outcome: null,
      inspectedOn: null,
      rawGrade: null,
      rawScore: null,
      closedByAuthority: false,
    },
  ],
  isTruncated: false,
  hasDateRange: true,
}

beforeEach(() => {
  fetchEstablishmentReport.mockReset()
  fetchEstablishmentReport.mockResolvedValue(report)
  fetchFilterOptions.mockReset()
  fetchFilterOptions.mockResolvedValue({
    cuisines: ['American', 'Bangladeshi'],
    localities: ['Bronx', 'Manhattan', 'Queens'],
    localityBounds: [],
  })
})

describe('EstablishmentsReport', () => {
  it('lists establishments with their latest result', async () => {
    render(<EstablishmentsReport />)

    const row = await screen.findByRole('row', { name: /ADDA GHOR/ })

    expect(within(row).getByText('Poor')).toBeInTheDocument()
    expect(within(row).getByText('Grade C')).toBeInTheDocument()
    expect(within(row).getByText('21 February 2026')).toBeInTheDocument()
  })

  /**
   * The distinction the whole table exists to preserve. Both rows have no result; merging them into
   * a blank cell or a shared "no data" would lose which is which, and they mean different things —
   * one is a published state, the other a consequence of the selected dates.
   */
  it('tells never-inspected apart from not-inspected-in-this-period', async () => {
    render(<EstablishmentsReport />)

    const never = await screen.findByRole('row', { name: /PARTNERS COFFEE/ })
    const quiet = screen.getByRole('row', { name: /QUIET DINER/ })

    expect(within(never).getByText('Never inspected')).toBeInTheDocument()
    expect(within(quiet).getByText('Not in this period')).toBeInTheDocument()
  })

  /**
   * The address is in the row because several hundred establishments in this data share a name —
   * DUNKIN alone appears 307 times. A name alone does not identify a place.
   */
  it('identifies a place by address as well as name', async () => {
    render(<EstablishmentsReport />)

    const row = await screen.findByRole('row', { name: /ADDA GHOR/ })

    expect(within(row).getByText('31-14 31ST AVENUE')).toBeInTheDocument()
  })

  it('announces which column is sorted', async () => {
    render(<EstablishmentsReport />)

    await screen.findByRole('row', { name: /ADDA GHOR/ })

    expect(screen.getByRole('columnheader', { name: /Establishment/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
  })

  it('re-sorts when a column header is activated', async () => {
    const user = userEvent.setup()

    render(<EstablishmentsReport />)
    await screen.findByRole('row', { name: /ADDA GHOR/ })

    await user.click(screen.getByRole('button', { name: /Result/ }))

    expect(screen.getByRole('columnheader', { name: /Result/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
  })

  /**
   * A contradiction the API answers with zero rows. "0 results" alone reads as a broken report
   * rather than as a consequence of the question, so it is named before the answer arrives.
   */
  it('explains the filter combination that cannot match anything', async () => {
    const user = userEvent.setup()

    render(<EstablishmentsReport />)
    await screen.findByRole('row', { name: /ADDA GHOR/ })

    await user.selectOptions(screen.getByLabelText(/^result$/i), 'Good')
    await user.selectOptions(screen.getByLabelText(/never inspected/i), 'true')

    expect(screen.getByText(/cannot match anything/i)).toBeInTheDocument()
  })

  /**
   * Which rows a truncated response dropped is arbitrary, so the count describes what came back.
   * "More than" is the strongest true claim available.
   */
  it('does not state a bare count from a truncated result', async () => {
    fetchEstablishmentReport.mockResolvedValue({ ...report, isTruncated: true })

    render(<EstablishmentsReport />)

    expect(await screen.findByText(/More than 3 establishments match/)).toBeInTheDocument()
  })

  it('states a plain count when the result is complete', async () => {
    render(<EstablishmentsReport />)

    expect(await screen.findByText('3 establishments.')).toBeInTheDocument()
  })

  it("reports the API's own sentence when the report cannot be run", async () => {
    fetchEstablishmentReport.mockRejectedValue(
      new Error('This API allows 10 report requests every 60 seconds.'),
    )

    render(<EstablishmentsReport />)

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('10 report requests every 60 seconds')
  })

  it('cannot export a report that has not loaded', () => {
    fetchEstablishmentReport.mockReturnValue(new Promise(() => {}))

    render(<EstablishmentsReport />)

    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled()
  })
})
