import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetSummary } from '../api/contract'
import { LandingPage } from './LandingPage'

const fetchDatasetSummary = vi.fn()

vi.mock('../api/client', () => ({ fetchDatasetSummary: (...args: unknown[]) => fetchDatasetSummary(...args) }))

const summary: DatasetSummary = {
  establishmentCount: 23528,
  awaitingFirstInspectionCount: 3605,
  inspectionCount: 29601,
  localityCount: 5,
  cuisineCount: 89,
  latestInspectionOn: '2026-06-01',
}

beforeEach(() => {
  fetchDatasetSummary.mockReset()
  fetchDatasetSummary.mockResolvedValue(summary)
})

describe('LandingPage', () => {
  it('says what the site is before any data arrives', () => {
    render(<LandingPage onNavigate={vi.fn()} />)

    expect(
      screen.getByRole('heading', { name: /New York City restaurant inspections/i }),
    ).toBeInTheDocument()
  })

  it('states the dataset figures it was given', async () => {
    render(<LandingPage onNavigate={vi.fn()} />)

    expect(await screen.findByText('23,528')).toBeInTheDocument()
    expect(screen.getByText('29,601')).toBeInTheDocument()
    expect(screen.getByText('89')).toBeInTheDocument()
  })

  /**
   * The most misread number in this dataset. A reader who assumes every establishment carries a
   * grade misreads every other figure on the page, so it gets its own tile and its own sentence
   * rather than being folded into the total.
   */
  it('gives never-inspected establishments their own figure', async () => {
    render(<LandingPage onNavigate={vi.fn()} />)

    expect(await screen.findByText('3,605')).toBeInTheDocument()
    expect(screen.getByText(/never inspected/i)).toBeInTheDocument()
    expect(screen.getByText(/published state, not missing data/i)).toBeInTheDocument()
  })

  /**
   * The trap this project has carried since the map's first slice: '2026-06-01' through `new Date()`
   * is UTC midnight, which renders as 31 May in New York.
   */
  it('renders the freshness date as the day it happened', async () => {
    render(<LandingPage onNavigate={vi.fn()} />)

    expect(await screen.findByText('1 June 2026')).toBeInTheDocument()
    expect(screen.queryByText('31 May 2026')).not.toBeInTheDocument()
  })

  /**
   * A zero here is a factual claim — "there are no establishments" — so the figures are withheld
   * entirely while loading rather than rendered as zeroes or dashes that happen to be wrong.
   */
  it('shows no figures at all until they are known', () => {
    fetchDatasetSummary.mockReturnValue(new Promise(() => {}))

    render(<LandingPage onNavigate={vi.fn()} />)

    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/counting the dataset/i)
  })

  /**
   * The page survives without its numbers: it still explains what the site is and still links to the
   * map. Only the figures are lost, and the reason is stated rather than left as a spinner.
   */
  it('keeps the page usable when the summary cannot be loaded', async () => {
    fetchDatasetSummary.mockRejectedValue(new Error('The API could not be reached.'))

    render(<LandingPage onNavigate={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('The API could not be reached.')
    expect(screen.getByRole('link', { name: /open the map/i })).toBeInTheDocument()
  })

  /**
   * Provenance is a credibility signal rather than a legal hedge: the page states whose data this is
   * and that it is neither official nor live.
   */
  it('names its source and disclaims being the official record', () => {
    render(<LandingPage onNavigate={vi.fn()} />)

    expect(screen.getByRole('link', { name: /NYC Open Data/i })).toHaveAttribute(
      'href',
      expect.stringContaining('data.cityofnewyork.us'),
    )
    expect(screen.getByText(/not affiliated with the City of New York/i)).toBeInTheDocument()
  })
})
