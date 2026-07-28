import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EstablishmentReport } from '../api/contract'
import { EstablishmentsReport } from './EstablishmentsReport'

const fetchEstablishmentReport = vi.hoisted(() => vi.fn())
const fetchFilterOptions = vi.hoisted(() => vi.fn())
const onNavigate = vi.fn()

vi.mock('../api/client', () => ({ fetchEstablishmentReport, fetchFilterOptions }))

const report: EstablishmentReport = {
  rows: [
    {
      id: 1,
      name: 'ADDA GHOR',
      addressLine: '31-14 31ST AVENUE',
      locality: 'Queens',
      cuisine: 'Bangladeshi',
      phone: '7185550100',
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
      phone: null,
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
      phone: '9295551234',
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
  onNavigate.mockClear()
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
    render(<EstablishmentsReport onNavigate={onNavigate} />)

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
    render(<EstablishmentsReport onNavigate={onNavigate} />)

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
    render(<EstablishmentsReport onNavigate={onNavigate} />)

    const row = await screen.findByRole('row', { name: /ADDA GHOR/ })

    expect(within(row).getByText('31-14 31ST AVENUE')).toBeInTheDocument()
  })

  it('announces which column is sorted', async () => {
    render(<EstablishmentsReport onNavigate={onNavigate} />)

    await screen.findByRole('row', { name: /ADDA GHOR/ })

    expect(screen.getByRole('columnheader', { name: /Establishment/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
  })

  it('re-sorts when a column header is activated', async () => {
    const user = userEvent.setup()

    render(<EstablishmentsReport onNavigate={onNavigate} />)
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

    render(<EstablishmentsReport onNavigate={onNavigate} />)
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

    render(<EstablishmentsReport onNavigate={onNavigate} />)

    expect(await screen.findByText(/More than 3 establishments match/)).toBeInTheDocument()
  })

  it('states a plain count when the result is complete', async () => {
    render(<EstablishmentsReport onNavigate={onNavigate} />)

    expect(await screen.findByText('3 establishments.')).toBeInTheDocument()
  })

  it("reports the API's own sentence when the report cannot be run", async () => {
    fetchEstablishmentReport.mockRejectedValue(
      new Error('This API allows 10 report requests every 60 seconds.'),
    )

    render(<EstablishmentsReport onNavigate={onNavigate} />)

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('10 report requests every 60 seconds')
  })

  /**
   * The click a reporting suite was missing. The row's name is a real anchor to the map, deep-linked
   * at that establishment — machinery that already existed, since `?id=` frames the camera and opens
   * the record.
   *
   * An anchor rather than a button, so middle-click and "copy link address" work and a row can be
   * shared. Asserted by role for that reason: `getByRole('link')` fails against a button.
   */
  it('links each row to that establishment on the map', async () => {
    render(<EstablishmentsReport onNavigate={onNavigate} />)

    const link = await screen.findByRole('link', { name: 'ADDA GHOR' })

    expect(link).toHaveAttribute('href', '/map?id=1')
  })

  it('navigates in-page on an ordinary click rather than reloading', async () => {
    const user = userEvent.setup()

    render(<EstablishmentsReport onNavigate={onNavigate} />)
    await screen.findByRole('link', { name: 'ADDA GHOR' })

    await user.click(screen.getByRole('link', { name: 'ADDA GHOR' }))

    expect(onNavigate).toHaveBeenCalledWith('map', '?id=1')
  })

  /**
   * The phone is the only contactable detail the city publishes — no website exists in any of the
   * 99,050 stored payloads. It is a real digit string rather than anything inferred, which is the
   * only kind of contact detail worth putting on screen.
   */
  it('makes a published phone number callable', async () => {
    render(<EstablishmentsReport onNavigate={onNavigate} />)

    const link = await screen.findByRole('link', { name: '(718) 555-0100' })

    expect(link).toHaveAttribute('href', 'tel:7185550100')
  })

  /** No number published is a dash, not an empty cell pretending the column does not apply. */
  it('says nothing rather than guessing when no number is published', async () => {
    render(<EstablishmentsReport onNavigate={onNavigate} />)

    const row = await screen.findByRole('row', { name: /PARTNERS COFFEE/ })

    expect(within(row).queryByRole('link', { name: /^\(/ })).not.toBeInTheDocument()
  })

  /** Phone is a column of its own, not something tucked into another cell. */
  it('gives the phone its own sortable column', async () => {
    render(<EstablishmentsReport onNavigate={onNavigate} />)

    await screen.findByRole('row', { name: /ADDA GHOR/ })

    expect(screen.getByRole('columnheader', { name: /Phone/ })).toBeInTheDocument()

    // In its own cell, at the end of the row, rather than inside the name or result cell.
    const row = screen.getByRole('row', { name: /ADDA GHOR/ })
    const cells = within(row).getAllByRole('cell')

    expect(cells).toHaveLength(6)
    expect(cells[5]).toHaveTextContent('(718) 555-0100')
  })

  it('cannot export a report that has not loaded', () => {
    fetchEstablishmentReport.mockReturnValue(new Promise(() => {}))

    render(<EstablishmentsReport onNavigate={onNavigate} />)

    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled()
  })
})
