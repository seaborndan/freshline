import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Legend } from './Legend'

describe('Legend', () => {
  it('is a titled region rather than a floating box of colours', () => {
    render(<Legend />)

    expect(screen.getByRole('heading', { name: 'What the colours mean' })).toBeInTheDocument()
  })

  // The acceptance criterion for the milestone is that someone understands the map without being
  // told. These are the two rows that decide whether that is true: together they are 42% of the
  // pins, neither is a grade, and "Ungraded" alone does not say how it differs from having no
  // record at all.
  it('explains the two states that are not grades, in words', () => {
    render(<Legend />)

    const ungraded = screen.getByText('Ungraded').closest('li')
    expect(within(ungraded as HTMLElement).getByText(/no grade was published/i)).toBeInTheDocument()

    const never = screen.getByText('Never inspected').closest('li')
    expect(
      within(never as HTMLElement).getByText(/no inspection on record/i),
    ).toBeInTheDocument()
  })

  it('names every state on the scale', () => {
    render(<Legend />)

    for (const label of ['Good', 'Fair', 'Poor', 'Awaiting re-inspection']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  // It is the latest outcome for no establishment in the data, so it can never be checked by
  // looking at the map. It is in the legend so that the day one appears, it is already explained.
  it('includes the outcome that appears on no pin today', () => {
    render(<Legend />)

    expect(screen.getByText('Awaiting re-inspection')).toBeInTheDocument()
  })

  it('describes closure as something that can happen at any grade', () => {
    render(<Legend />)

    const closed = screen.getByText('Closed by the authority').closest('li')
    expect(within(closed as HTMLElement).getByText(/any grade/i)).toBeInTheDocument()
  })

  it('lists one row per state and one for the closure modifier', () => {
    render(<Legend />)

    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })
})
