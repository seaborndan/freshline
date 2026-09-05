import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { fetchProspects } from '../api/client'
import { ProspectsPage } from './ProspectsPage'
import { readSaved, storageKey } from './model'
vi.mock('../api/client', () => ({ fetchProspects: vi.fn() }))
vi.mock('../filters/useFilterOptions', () => ({ useFilterOptions: () => ({ localities: ['Queens'] }) }))
const prospect = { id: 1, name: 'TEST CAFE', address: '1 Test Street', locality: 'Queens', phone: null,
  inspectedOn: '2026-07-01', evidence: [{ code: '04L', description: 'Evidence of mice.' }] }
beforeEach(() => { localStorage.clear(); vi.mocked(fetchProspects).mockResolvedValue({ items: [prospect], isTruncated: false }) })

it('saves evidence and notes in a named list and restores them after remount', async () => {
  const user = userEvent.setup()
  const view = render(<ProspectsPage onNavigate={vi.fn()} />)
  await screen.findByText('TEST CAFE')
  await user.click(screen.getByRole('button', { name: 'Save to list' }))
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
  const input = screen.getByRole('combobox', { name: 'List name' })
  await user.clear(input)
  await user.type(input, 'Queens follow-up')
  await user.click(screen.getByRole('button', { name: 'Save to list' }))
  expect(readSaved(localStorage.getItem(storageKey))).toHaveLength(2)
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
