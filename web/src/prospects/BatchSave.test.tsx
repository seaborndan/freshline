import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { BatchSave } from './BatchSave'
import type { SavedProspect } from './model'

const saved: SavedProspect = { id: 1, name: 'Cafe', list: 'Queens', notes: 'Keep this note', stage: 'Contacted', followUpOn: '2026-09-10', address: null, locality: 'Queens', phone: null, inspectedOn: '2026-07-01', evidence: [{ code: '04L', description: 'Recorded citation' }] }
it('previews duplicate memberships and sends only new records to persistence', async () => {
  const onSave = vi.fn().mockReturnValue(true)
  render(<BatchSave selected={[saved, { ...saved, id: 2, name: 'Other cafe' }]} saved={[saved]} onSave={onSave} onClear={vi.fn()} />)
  await userEvent.type(screen.getByRole('combobox', { name: 'Destination list' }), 'Queens')
  expect(screen.getByRole('status')).toHaveTextContent('1 new · 1 already')
  await userEvent.click(screen.getByRole('button', { name: 'Save selected prospects' }))
  expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ id: 2, list: 'Queens', stage: 'To review', notes: '' })], 'Queens')
  expect(saved.notes).toBe('Keep this note')
})
it('disables empty destinations and selections already saved in full', async () => {
  render(<BatchSave selected={[saved]} saved={[saved]} onSave={vi.fn()} onClear={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Save selected prospects' })).toBeDisabled()
  await userEvent.type(screen.getByRole('combobox', { name: 'Destination list' }), 'Queens')
  expect(screen.getByRole('button', { name: 'Save selected prospects' })).toBeDisabled()
})
