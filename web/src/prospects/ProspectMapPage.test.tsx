import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fetchProspectMap } from '../api/client'
import { ProspectMapPage } from './ProspectMapPage'
import { storageKey } from './model'
vi.mock('../api/client', () => ({ fetchProspectMap: vi.fn() }))
vi.mock('../detail/useEstablishmentDetail', () => ({ useEstablishmentDetail: () => ({ detail: null, isLoading: false, failure: null }) }))
vi.mock('../map/MapView', () => ({ MapView: ({ establishments }: { establishments: { name: string }[] }) => <div aria-label="List map">{establishments.map(p => p.name).join(',')}</div> }))
const saved = (id: number, list: string) => ({ id, list, name: `Cafe ${id}`, address: null, locality: null, phone: null, inspectedOn: '2026-07-01', evidence: [{ code: '04L', description: null }], stage: 'To review', notes: '' })
beforeEach(() => {
  history.replaceState(null, '', '/prospects/map?list=My%20list')
  localStorage.setItem(storageKey, JSON.stringify([saved(1, 'My list'), saved(2, 'My list'), saved(3, 'Other list')]))
})
it('maps only the chosen list and reports records without pins', async () => {
  vi.mocked(fetchProspectMap).mockResolvedValue({ items: [{ id: 1, name: 'Cafe 1', latitude: 40.7, longitude: -74, isAwaitingFirstInspection: true, latestInspection: null }], isTruncated: false })
  render(<ProspectMapPage />)
  expect(await screen.findByText(/1 of 2 saved places mapped/)).toHaveTextContent('1 unavailable or without coordinates')
  expect(fetchProspectMap).toHaveBeenCalledWith([1, 2], expect.any(AbortSignal))
  expect(screen.getByLabelText('List map')).toHaveTextContent('Cafe 1')
  expect(screen.queryByText('Cafe 3')).not.toBeInTheDocument()
})
it('reports a failed map load without claiming the list is empty', async () => {
  vi.mocked(fetchProspectMap).mockRejectedValue(new Error('offline'))
  render(<ProspectMapPage />)
  expect(await screen.findByText(/Could not load this list/)).toBeInTheDocument()
  expect(screen.queryByText(/No places to map/)).not.toBeInTheDocument()
})

