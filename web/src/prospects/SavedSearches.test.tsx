import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { SavedSearches } from './SavedSearches'
import { readSearches, resolveSearch, searchStorageKey } from './searchBookmarks'
const search = { category: 'all', locality: 'Queens', from: '2026-06-01', to: '2026-07-01' }
beforeEach(() => localStorage.clear())
it('resolves inclusive rolling windows across leap days and year boundaries', () => {
  expect(resolveSearch({ ...search, name: 'Rolling', rollingDays: 7 }, new Date(2024, 2, 1, 23, 59))).toMatchObject({ from: '2024-02-24', to: '2024-03-01' })
  expect(resolveSearch({ ...search, name: 'Rolling', rollingDays: 30 }, new Date(2026, 0, 5))).toMatchObject({ from: '2025-12-07', to: '2026-01-05' })
  expect(resolveSearch({ ...search, name: 'Fixed' }, new Date(2027, 0, 1))).toEqual(search)
  expect(() => readSearches(JSON.stringify([{ ...search, name: 'Invalid', rollingDays: -1 }]))).toThrow()
})
it('stores the selected rolling window without changing submitted category or borough', async () => {
  render(<SavedSearches search={search} categories={[]} onRun={vi.fn()} />)
  await userEvent.click(screen.getByText('Saved searches (0)'))
  await userEvent.type(screen.getByRole('textbox', { name: 'Search name' }), 'Recent Queens')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Date behavior' }), '30')
  await userEvent.click(screen.getByRole('button', { name: 'Save submitted search' }))
  expect(readSearches(localStorage.getItem(searchStorageKey))).toEqual([{ ...search, name: 'Recent Queens', rollingDays: 30 }])
})
it('rejects invalid dates and duplicate names in stored searches', () => {
  expect(() => readSearches(JSON.stringify([{ ...search, name: 'A', from: '2026-02-30' }]))).toThrow()
  expect(() => readSearches(JSON.stringify([{ ...search, name: 'A' }, { ...search, name: 'A' }]))).toThrow()
})
it('saves submitted filters, runs them and supports removal undo', async () => {
  const onRun = vi.fn()
  render(<SavedSearches search={search} categories={[]} onRun={onRun} />)
  await userEvent.click(screen.getByText('Saved searches (0)'))
  await userEvent.type(screen.getByRole('textbox', { name: 'Search name' }), 'Queens')
  await userEvent.click(screen.getByRole('button', { name: 'Save submitted search' }))
  expect(readSearches(localStorage.getItem(searchStorageKey))).toEqual([{ ...search, name: 'Queens' }])
  await userEvent.click(screen.getByRole('button', { name: /Run search/ }))
  expect(onRun).toHaveBeenCalledWith(search)
  await userEvent.click(screen.getByRole('button', { name: /Remove search/ }))
  expect(readSearches(localStorage.getItem(searchStorageKey))).toEqual([])
  await userEvent.click(screen.getByRole('button', { name: 'Undo search removal' }))
  expect(readSearches(localStorage.getItem(searchStorageKey))).toHaveLength(1)
})
it('refuses stale writes from another tab', async () => {
  render(<SavedSearches search={search} categories={[]} onRun={vi.fn()} />)
  await userEvent.click(screen.getByText('Saved searches (0)'))
  localStorage.setItem(searchStorageKey, JSON.stringify([{ ...search, name: 'Other tab' }]))
  await userEvent.type(screen.getByRole('textbox', { name: 'Search name' }), 'Mine')
  await userEvent.click(screen.getByRole('button', { name: 'Save submitted search' }))
  expect(screen.getByRole('status')).toHaveTextContent('changed in another tab')
  expect(readSearches(localStorage.getItem(searchStorageKey)).map(p => p.name)).toEqual(['Other tab'])
})
