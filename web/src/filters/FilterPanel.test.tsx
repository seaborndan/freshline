import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EstablishmentFilterOptions } from '../api/contract'
import { FilterPanel } from './FilterPanel'

const options: EstablishmentFilterOptions = {
  cuisines: ['American', 'Chinese', 'Coffee/Tea'],
  localities: ['Bronx', 'Brooklyn', 'Manhattan'],
}

function renderPanel(overrides: Partial<Parameters<typeof FilterPanel>[0]> = {}) {
  const onChange = vi.fn()

  render(<FilterPanel filters={{}} options={options} onChange={onChange} {...overrides} />)

  return { onChange, user: userEvent.setup() }
}

describe('FilterPanel', () => {
  it('offers the vocabulary the API published, not one of its own', () => {
    renderPanel()

    expect(screen.getByRole('option', { name: 'Coffee/Tea' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Brooklyn' })).toBeInTheDocument()
  })

  it('names the outcomes the way the legend does', () => {
    renderPanel()

    // "Awaiting re-inspection", not "PendingReinspection" — the enum name is the wire format, not
    // something to show a person.
    expect(screen.getByRole('option', { name: 'Awaiting re-inspection' })).toBeInTheDocument()
  })

  it('announces a chosen borough upward rather than keeping it', async () => {
    const { onChange, user } = renderPanel()

    await user.selectOptions(screen.getByLabelText('Borough'), 'Brooklyn')

    expect(onChange).toHaveBeenCalledWith({ locality: 'Brooklyn' })
  })

  // Undefined removes the key. An empty string would go on the wire as `?cuisine=`, an exact match
  // against something nothing has — so "Any" would return an empty map.
  it('removes a filter rather than sending an empty value', async () => {
    const { onChange, user } = renderPanel({ filters: { cuisine: 'Chinese' } })

    await user.selectOptions(screen.getByLabelText('Cuisine'), '')

    expect(onChange).toHaveBeenCalledWith({})
  })

  // The two combinations that can only ever return nothing. `outcome` matches the latest
  // inspection, and cuisine is null for exactly the never-inspected establishments — an exact
  // correspondence in the live data, 3,605 rows, zero exceptions.
  it('disables the filters that cannot combine with never-inspected', () => {
    renderPanel({ filters: { awaitingFirstInspection: true } })

    expect(screen.getByLabelText('Cuisine')).toBeDisabled()
    expect(screen.getByLabelText('Latest result')).toBeDisabled()
    expect(screen.getByLabelText('Borough')).toBeEnabled()
  })

  // Disabled rather than hidden, and explained: a control that vanishes leaves a user wondering
  // what they did, while a sentence teaches them something true about the data.
  it('says why those two are unavailable', () => {
    renderPanel({ filters: { awaitingFirstInspection: true } })

    expect(screen.getByText(/never been inspected has no result/i)).toBeInTheDocument()
    expect(screen.getByText(/publishes no cuisine/i)).toBeInTheDocument()
  })

  it('leaves everything available when never-inspected is off', () => {
    renderPanel()

    expect(screen.getByLabelText('Cuisine')).toBeEnabled()
    expect(screen.getByLabelText('Latest result')).toBeEnabled()
    expect(screen.queryByText(/publishes no cuisine/i)).not.toBeInTheDocument()
  })

  // The vocabulary is fetched separately and can fail on its own. When it does, the two dropdowns
  // it feeds are unusable and everything else still works — the map does not come down because a
  // dropdown could not be populated.
  it('disables the vocabulary dropdowns when the vocabulary is unavailable', () => {
    renderPanel({ options: null })

    expect(screen.getByLabelText('Cuisine')).toBeDisabled()
    expect(screen.getByLabelText('Borough')).toBeDisabled()
    expect(screen.getByLabelText('Name starts with')).toBeEnabled()
    expect(screen.getByLabelText('Only places never inspected')).toBeEnabled()
  })

  it('offers a way back to no filters at all, only once there are some', async () => {
    const { onChange, user } = renderPanel({ filters: { locality: 'Bronx' } })

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(onChange).toHaveBeenCalledWith({})
  })

  it('hides the clear control when nothing is filtered', () => {
    renderPanel()

    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })
})
