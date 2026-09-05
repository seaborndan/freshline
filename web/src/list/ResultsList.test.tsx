import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MapEstablishment } from '../api/contract'
import { ResultsList, visibleRowCount } from './ResultsList'

function pin(id: number, name: string, outcome: 'Good' | 'Poor' | null = 'Good'): MapEstablishment {
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

describe('ResultsList', () => {
  it('lists the establishments in view', () => {
    render(
      <ResultsList
        establishments={[pin(1, 'ZAZA'), pin(2, 'ARTICHOKE')]}
        isTruncated={false}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /ARTICHOKE/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ZAZA/ })).toBeInTheDocument()
  })

  // The map endpoint returns primary-key order, which its own documentation calls arbitrary. Name
  // order is what the list endpoint uses, so the two agree.
  it('sorts by name rather than keeping the arbitrary order it was given', () => {
    render(
      <ResultsList
        establishments={[pin(1, 'ZAZA'), pin(2, 'ARTICHOKE'), pin(3, 'MOMOFUKU')]}
        isTruncated={false}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )

    const names = screen.getAllByRole('button').map((button) => button.textContent)
    expect(names[0]).toContain('ARTICHOKE')
    expect(names[2]).toContain('ZAZA')
  })

  // Colour alone says nothing to a screen reader, and the swatch is decoration. The state is a word
  // on every row for the same reason the legend spells its entries out.
  it('names each state in words, not only as a colour', () => {
    render(
      <ResultsList
        establishments={[pin(1, 'ZAZA', 'Poor'), pin(2, 'ARTICHOKE', null)]}
        isTruncated={false}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )

    expect(within(screen.getByRole('button', { name: /ZAZA/ })).getByText('Poor')).toBeInTheDocument()
    expect(
      within(screen.getByRole('button', { name: /ARTICHOKE/ })).getByText('Never inspected'),
    ).toBeInTheDocument()
  })

  // The whole point of the panel: a pin is a pixel on a canvas and takes no focus, so this is the
  // only way to reach an establishment without a mouse.
  it('can be reached and activated from the keyboard', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ResultsList
        establishments={[pin(7, 'ARTICHOKE')]}
        isTruncated={false}
        selectedId={null}
        onSelect={onSelect}
      />,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: /ARTICHOKE/ })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(7)
  })

  it('marks the selected row in the accessibility tree, not only in the highlight', () => {
    render(
      <ResultsList
        establishments={[pin(1, 'ZAZA'), pin(2, 'ARTICHOKE')]}
        isTruncated={false}
        selectedId={2}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /ARTICHOKE/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /ZAZA/ })).not.toHaveAttribute('aria-current')
  })

  // A viewport can hold a thousand establishments and re-renders on every pan. A thousand rows of
  // DOM per pan is work landing on the frames a gesture needs.
  it('renders a bounded window and says that it did', () => {
    const many = Array.from({ length: 120 }, (_, index) =>
      pin(index, `PLACE ${String(index).padStart(3, '0')}`),
    )

    render(
      <ResultsList establishments={many} isTruncated={false} selectedId={null} onSelect={vi.fn()} />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(visibleRowCount)
    expect(screen.getByText(/Showing 50 of 120/)).toBeInTheDocument()
  })

  // Which rows a truncated response dropped is arbitrary, so "50 of 1,000" would be counting an
  // arbitrary subset and calling it the area.
  it('never states a total from a truncated response', () => {
    const many = Array.from({ length: 120 }, (_, index) => pin(index, `PLACE ${index}`))

    render(
      <ResultsList establishments={many} isTruncated selectedId={null} onSelect={vi.fn()} />,
    )

    expect(screen.getByText(/more than 120/)).toBeInTheDocument()
    expect(screen.queryByText(/Showing 50 of 120\./)).not.toBeInTheDocument()
  })

  it('reaches places past the first fifty and resets when the viewport data changes', async () => {
    const many = Array.from({ length: 120 }, (_, i) => pin(i, `PLACE ${String(i).padStart(3, '0')}`))
    const onSelect = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<ResultsList establishments={many} isTruncated selectedId={null} onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: /PLACE 050/ }))
    expect(onSelect).toHaveBeenCalledWith(50)
    expect(screen.getAllByRole('listitem')).toHaveLength(50)
    expect(screen.getByText(/more than 120/)).toBeInTheDocument()
    rerender(<ResultsList establishments={[pin(999, 'NEW AREA')]} isTruncated={false} selectedId={null} onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: /NEW AREA/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  it('says so when the view holds nothing', () => {
    render(
      <ResultsList establishments={[]} isTruncated={false} selectedId={null} onSelect={vi.fn()} />,
    )

    expect(screen.getByText('Nothing here.')).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
