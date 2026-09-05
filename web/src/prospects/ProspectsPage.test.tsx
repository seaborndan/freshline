import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { fetchProspectCategories, fetchProspects } from '../api/client'
import { ProspectsPage } from './ProspectsPage'
import { readSaved, storageKey } from './model'
vi.mock('../api/client', () => ({ fetchProspects: vi.fn(), fetchProspectCategories: vi.fn() }))
vi.mock('../filters/useFilterOptions', () => ({ useFilterOptions: () => ({ localities: ['Queens'] }) }))
vi.mock('../landing/useDatasetSummary', () => ({ useDatasetSummary: () => ({ summary: { latestInspectionOn: '2026-07-22' }, failure: null }) }))
const prospect = { id: 1, name: 'TEST CAFE', address: '1 Test Street', locality: 'Queens', phone: null,
  inspectedOn: '2026-07-01', evidence: [{ code: '04L', description: 'Evidence of mice.' }] }
it('selects a page and saves a batch without replacing existing work', async () => {
  localStorage.setItem(storageKey, JSON.stringify([{ ...prospect, list: 'Queens', stage: 'Contacted', notes: 'Keep my note' }]))
  vi.mocked(fetchProspects).mockResolvedValue({ items: [prospect, { ...prospect, id: 2, name: 'SECOND CAFE' }], isTruncated: false })
  render(<ProspectsPage onNavigate={vi.fn()} />)
  await screen.findByText('SECOND CAFE')
  await userEvent.click(screen.getByRole('button', { name: 'Select this page (2)' }))
  await userEvent.type(screen.getByRole('combobox', { name: 'Destination list' }), 'Queens')
  await userEvent.click(screen.getByRole('button', { name: 'Save selected prospects' }))
  const records = readSaved(localStorage.getItem(storageKey))
  expect(records).toHaveLength(2)
  expect(records[0].notes).toBe('Keep my note')
  expect(records[0].stage).toBe('Contacted')
  expect(records[1].stage).toBe('To review')
  expect(screen.queryByRole('form', { name: 'Save selected prospects' })).not.toBeInTheDocument()
})
beforeEach(() => {
  history.replaceState(null, '', '/prospects')
  localStorage.clear()
  vi.mocked(fetchProspects).mockClear().mockResolvedValue({ items: [prospect], isTruncated: false })
  vi.mocked(fetchProspectCategories).mockResolvedValue([
    { id: 'sanitation', label: 'Cleaning & sanitation', description: 'Surface cleaning evidence.', codes: ['06D', '10F'] },
  ])
})

it('filters previously saved discoveries without mistaking them for absent evidence', async () => {
  localStorage.setItem(storageKey, JSON.stringify([{ ...prospect, list: 'Elsewhere', stage: 'To review', notes: '' }]))
  render(<ProspectsPage onNavigate={vi.fn()} />)
  await screen.findByText('TEST CAFE')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Only unsaved places' }))
  expect(screen.queryByRole('heading', { name: 'TEST CAFE' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'These loaded matches are already in your lists.' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Only unsaved places' }))
  expect(screen.getByRole('heading', { name: 'TEST CAFE' })).toBeInTheDocument()
})

it('saves evidence and notes in a named list and restores them after remount', async () => {
  const user = userEvent.setup()
  const view = render(<ProspectsPage onNavigate={vi.fn()} />)
  await screen.findByText('TEST CAFE')
  await user.click(screen.getByRole('button', { name: 'Save to list' }))
  await user.type(screen.getByRole('combobox', { name: 'List name' }), 'My outreach')
  await user.click(screen.getByRole('button', { name: 'Save prospect' }))
  await user.click(screen.getByRole('button', { name: /Saved lists/ }))
  await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Ask about service schedule')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Contact status' }), 'Follow up')
  view.unmount()
  render(<ProspectsPage onNavigate={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: /Saved lists/ }))
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Ask about service schedule')
  expect(screen.getByRole('combobox', { name: 'Contact status' })).toHaveValue('Follow up')
  expect(readSaved(localStorage.getItem(storageKey))[0].evidence).toEqual(prospect.evidence)
})

it('keeps the same restaurant independent across named lists', async () => {
  const user = userEvent.setup()
  render(<ProspectsPage onNavigate={vi.fn()} />)
  await screen.findByText('TEST CAFE')
  await user.click(screen.getByRole('button', { name: 'Save to list' }))
  await user.type(screen.getByRole('combobox', { name: 'List name' }), 'First list')
  await user.click(screen.getByRole('button', { name: 'Save prospect' }))
  await user.click(screen.getByRole('button', { name: 'Save to list' }))
  const input = screen.getByRole('combobox', { name: 'List name' })
  await user.clear(input)
  await user.type(input, 'Queens follow-up')
  await user.click(screen.getByRole('button', { name: 'Save prospect' }))
  expect(readSaved(localStorage.getItem(storageKey))).toHaveLength(2)
})

it('uses category selection for discovery and only asks for a list when saving', async () => {
  const user = userEvent.setup()
  render(<ProspectsPage onNavigate={vi.fn()} />)
  await screen.findByText('TEST CAFE')
  expect(screen.queryByRole('combobox', { name: 'List name' })).not.toBeInTheDocument()
  expect(fetchProspects).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'all' }), expect.any(AbortSignal))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Opportunity type' }), 'sanitation')
  await user.click(screen.getByRole('button', { name: 'Find prospects' }))
  expect(fetchProspects).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'sanitation' }), expect.any(AbortSignal))
  await screen.findByText('TEST CAFE')
  const calls = vi.mocked(fetchProspects).mock.calls.length
  await user.click(screen.getByRole('button', { name: 'Save to list' }))
  await user.type(screen.getByRole('combobox', { name: 'List name' }), 'Custom name')
  expect(vi.mocked(fetchProspects).mock.calls.length).toBe(calls)
})

it('does not silently overwrite unreadable saved data', async () => {
  localStorage.setItem(storageKey, '{broken')
  render(<ProspectsPage onNavigate={vi.fn()} />)
  await screen.findByText('TEST CAFE')
  expect(screen.getByRole('alert')).toHaveTextContent(/unavailable/)
  expect(screen.getByRole('button', { name: 'Save to list' })).toBeDisabled()
  expect(localStorage.getItem(storageKey)).toBe('{broken')
})

it('links the evidence to the matching inspection history', async () => {
  render(<ProspectsPage onNavigate={vi.fn()} />)
  const heading = await screen.findByText('TEST CAFE')
  const card = heading.closest('article')!
  expect(within(card).getByRole('link', { name: /inspection history/ })).toHaveAttribute('href', '/map?id=1')
  expect(within(card).getByRole('link', { name: 'View on map' })).toHaveAttribute('href', '/map?id=1&focus=1')
})

it('maps saved cards individually and the selected named list together', async () => {
  localStorage.setItem(storageKey, JSON.stringify([{ ...prospect, list: 'Queens & Brooklyn', stage: 'To review', notes: '' }]))
  const user = userEvent.setup()
  render(<ProspectsPage onNavigate={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: /Saved lists/ }))
  expect(screen.getByRole('link', { name: 'View on map' })).toHaveAttribute('href', '/map?id=1&focus=1')
  expect(screen.getByRole('link', { name: 'View entire list on map' })).toHaveAttribute('href', '/prospects/map?list=Queens%20%26%20Brooklyn')
})

it('counts distinct saved lists rather than saved prospects in the tab', async () => {
  localStorage.setItem(storageKey, JSON.stringify([
    { ...prospect, list: 'Queens', stage: 'To review', notes: '' },
    { ...prospect, id: 2, list: 'Queens', stage: 'To review', notes: '' },
    { ...prospect, list: 'Brooklyn', stage: 'To review', notes: '' },
    { ...prospect, id: 3, list: 'Brooklyn', stage: 'To review', notes: '' },
  ]))
  render(<ProspectsPage onNavigate={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Saved lists (2)' })).toBeInTheDocument()
  await screen.findByText('TEST CAFE')
})

it('renames a list without losing notes and rejects collisions with another list', async () => {
  localStorage.setItem(storageKey, JSON.stringify([
    { ...prospect, list: 'Queens', stage: 'Follow up', notes: 'Keep this', followUpOn: '2026-09-05' },
    { ...prospect, list: 'Brooklyn', stage: 'To review', notes: 'Separate' },
  ]))
  const user = userEvent.setup()
  render(<ProspectsPage onNavigate={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: /Saved lists/ }))
  await user.click(screen.getByRole('button', { name: 'Rename list' }))
  const name = screen.getByRole('textbox', { name: 'New list name' })
  await user.clear(name); await user.type(name, 'Brooklyn')
  await user.click(screen.getByRole('button', { name: 'Save list name' }))
  expect(screen.getByRole('alert')).toHaveTextContent('already belongs')
  await user.clear(name); await user.type(name, 'Queens calls')
  await user.click(screen.getByRole('button', { name: 'Save list name' }))
  expect(readSaved(localStorage.getItem(storageKey))[0]).toMatchObject({ list: 'Queens calls', notes: 'Keep this', followUpOn: '2026-09-05' })
})

it('restores discovery from its URL and writes only submitted filters', async () => {
  history.replaceState(null, '', '/prospects?category=sanitation&locality=Queens&from=2026-06-01&to=2026-07-01')
  const user = userEvent.setup()
  render(<ProspectsPage onNavigate={vi.fn()} />)
  await screen.findByText('TEST CAFE')
  expect(fetchProspects).toHaveBeenLastCalledWith({ category: 'sanitation', locality: 'Queens', from: '2026-06-01', to: '2026-07-01' }, expect.any(AbortSignal))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Opportunity type' }), 'all')
  expect(new URLSearchParams(location.search).get('category')).toBe('sanitation')
  await user.click(screen.getByRole('button', { name: 'Find prospects' }))
  expect(new URLSearchParams(location.search).get('category')).toBe('all')
})

it('does not overwrite another tab’s newer work on an edit', async () => {
  const initial = { ...prospect, list: 'Queens', stage: 'To review', notes: '' }
  localStorage.setItem(storageKey, JSON.stringify([initial]))
  const user = userEvent.setup()
  render(<ProspectsPage onNavigate={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: /Saved lists/ }))
  localStorage.setItem(storageKey, JSON.stringify([{ ...initial, notes: 'Other tab update' }]))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Contact status' }), 'Contacted')
  expect(screen.getByRole('alert')).toHaveTextContent('changed in another tab')
  expect(readSaved(localStorage.getItem(storageKey))[0]).toMatchObject({ stage: 'To review', notes: 'Other tab update' })
})

it('undoes a removal without losing notes', async () => {
  localStorage.setItem(storageKey, JSON.stringify([{ ...prospect, list: 'Pest-control prospects', stage: 'Follow up', notes: 'Existing note' }]))
  const user = userEvent.setup()
  render(<ProspectsPage onNavigate={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: /Saved lists/ }))
  await user.click(screen.getByRole('button', { name: 'Remove from list' }))
  expect(readSaved(localStorage.getItem(storageKey))).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Undo removal' }))
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Existing note')
  expect(readSaved(localStorage.getItem(storageKey))[0].stage).toBe('Follow up')
})
