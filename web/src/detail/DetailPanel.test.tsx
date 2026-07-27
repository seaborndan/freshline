import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EstablishmentDetail, MapEstablishment } from '../api/contract'
import { DetailPanel } from './DetailPanel'
import type { DetailView } from './useEstablishmentDetail'
import detailFixture from '../api/__fixtures__/establishment-detail.json'

const loaded = detailFixture as unknown as EstablishmentDetail

const idle: DetailView = { detail: null, isLoading: false, failure: null }

function pin(id: number, name: string, outcome: 'Good' | 'Poor' | null): MapEstablishment {
  return {
    id,
    name,
    latitude: 40.757,
    longitude: -73.986,
    isAwaitingFirstInspection: outcome === null,
    latestInspection:
      outcome === null
        ? null
        : {
            inspectedOn: '2026-03-09',
            rawGrade: outcome === 'Good' ? 'A' : 'C',
            outcome,
            normalisedSeverity: 10,
            closedByAuthority: false,
          },
  }
}

describe('DetailPanel', () => {
  it('shows nothing when nothing has been clicked', () => {
    const { container } = render(
      <DetailPanel candidates={[]} view={idle} selectedId={null} onSelect={vi.fn()} onClose={vi.fn()} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  // 47 of the 238 points in the opening view carry more than one establishment and the busiest
  // carries 18; one address in the city carries 49. Answering with whichever feature came back
  // first would answer arbitrarily, and differently depending on how the source tiled.
  it('offers the choice when a click lands on several establishments', () => {
    render(
      <DetailPanel
        candidates={[pin(1, "XI'AN FAMOUS FOODS", 'Good'), pin(2, 'GOOP KITCHEN', 'Poor')]}
        view={idle}
        selectedId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: '2 places at this address' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /XI'AN FAMOUS FOODS/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /GOOP KITCHEN/ })).toBeInTheDocument()
  })

  // The dot's colour at a stacked point belongs to whichever establishment was drawn last, which is
  // to say nobody's. Each row carries its own state so the list answers the question the colour
  // raised.
  it('names each candidate state, since the shared dot could only show one', () => {
    render(
      <DetailPanel
        candidates={[pin(1, "XI'AN FAMOUS FOODS", 'Good'), pin(2, 'GOOP KITCHEN', 'Poor')]}
        view={idle}
        selectedId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const poor = screen.getByRole('button', { name: /GOOP KITCHEN/ })
    expect(within(poor).getByText('Poor')).toBeInTheDocument()
  })

  it('reports the chosen establishment upward rather than opening it itself', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <DetailPanel
        candidates={[pin(1, "XI'AN FAMOUS FOODS", 'Good'), pin(2, 'GOOP KITCHEN', 'Poor')]}
        view={idle}
        selectedId={null}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /GOOP KITCHEN/ }))

    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('shows the record when one establishment is chosen', () => {
    render(
      <DetailPanel
        candidates={[pin(21, 'POPEYES', 'Good')]}
        view={{ detail: loaded, isLoading: false, failure: null }}
        selectedId={21}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'POPEYES' })).toBeInTheDocument()
    expect(screen.getByText(/1351 FOREST AVENUE/)).toBeInTheDocument()
    expect(screen.getByText('Chicken')).toBeInTheDocument()
  })

  // The trap this project has been carrying since slice 1: "2026-03-09" through `new Date()` is UTC
  // midnight, which renders as the 8th in New York.
  it('renders inspection dates as the day they happened', () => {
    render(
      <DetailPanel
        candidates={[pin(21, 'POPEYES', 'Good')]}
        view={{ detail: loaded, isLoading: false, failure: null }}
        selectedId={21}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('9 March 2026')).toBeInTheDocument()
    expect(screen.queryByText('8 March 2026')).not.toBeInTheDocument()
  })

  it('shows the history newest first, with its violations', () => {
    render(
      <DetailPanel
        candidates={[pin(21, 'POPEYES', 'Good')]}
        view={{ detail: loaded, isLoading: false, failure: null }}
        selectedId={21}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const inspections = screen.getAllByRole('listitem').filter((item) => item.querySelector('.detail-inspection-head'))
    expect(inspections).toHaveLength(3)
    expect(within(inspections[0]).getByText('9 March 2026')).toBeInTheDocument()
    expect(within(inspections[0]).getByText('04L')).toBeInTheDocument()
  })

  // Closure is a separate fact from the grade — this establishment was closed while `Ungraded`,
  // with no letter grade at all.
  it('says when the authority closed a place, separately from its result', () => {
    render(
      <DetailPanel
        candidates={[pin(21, 'POPEYES', 'Good')]}
        view={{ detail: loaded, isLoading: false, failure: null }}
        selectedId={21}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText(/closed by the authority at this inspection/i)).toBeInTheDocument()
  })

  // Never inspected is a published state, not an absence in our records, and the panel has to say
  // so in words — it is the third-largest group on the map.
  it('states that a never-inspected place is a real state, not missing data', () => {
    const neverInspected: EstablishmentDetail = {
      ...loaded,
      name: 'PARTNERS COFFEE',
      isAwaitingFirstInspection: true,
      inspections: [],
    }

    render(
      <DetailPanel
        candidates={[pin(922, 'PARTNERS COFFEE', null)]}
        view={{ detail: neverInspected, isLoading: false, failure: null }}
        selectedId={922}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText(/no inspection on record/i)).toBeInTheDocument()
    expect(screen.getByText(/not missing information/i)).toBeInTheDocument()
  })

  it("reports the API's own sentence when the record cannot be loaded", () => {
    render(
      <DetailPanel
        candidates={[pin(999999, 'GONE', 'Good')]}
        view={{ detail: null, isLoading: false, failure: 'No establishment has id 999999.' }}
        selectedId={999999}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('No establishment has id 999999.')
  })

  it('can be closed', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <DetailPanel
        candidates={[pin(21, 'POPEYES', 'Good')]}
        view={{ detail: loaded, isLoading: false, failure: null }}
        selectedId={21}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalled()
  })

  // A shared `?id=` link names an establishment that is usually nowhere near the opening view, so
  // there is no pin for it among the candidates. Gating the panel on candidates alone hid it for
  // exactly the case the parameter exists to serve.
  it('shows a record for an establishment that has no pin on screen', () => {
    render(
      <DetailPanel
        candidates={[]}
        view={{ detail: loaded, isLoading: false, failure: null }}
        selectedId={21}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'POPEYES' })).toBeInTheDocument()
  })

  // A keyboard user who activates a row from the list would otherwise stay where they were: the
  // panel appears somewhere they cannot see, and the next Tab carries on down the list as if
  // nothing had happened. Moving focus is also what makes a screen reader read the record.
  it('takes focus when it opens', () => {
    render(
      <DetailPanel
        candidates={[pin(21, 'POPEYES', 'Good')]}
        view={{ detail: loaded, isLoading: false, failure: null }}
        selectedId={21}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    // The container, not the close button, so what gets announced is the name rather than "Close".
    expect(screen.getByRole('heading', { name: 'POPEYES' }).closest('section')).toHaveFocus()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <DetailPanel
        candidates={[pin(21, 'POPEYES', 'Good')]}
        view={{ detail: loaded, isLoading: false, failure: null }}
        selectedId={21}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    )

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })
})
