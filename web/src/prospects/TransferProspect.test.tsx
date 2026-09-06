import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { it, expect, vi } from 'vitest'
import { TransferProspect } from './TransferProspect'
import { transferProspect } from './workspace'
import type { SavedProspect } from './model'
const p: SavedProspect = { id: 1, name: 'Cafe', list: 'Territory', stage: 'Follow up', notes: 'Bring samples', followUpOn: '2026-09-10', address: null, locality: null, phone: null, inspectedOn: '2026-07-01', evidence: [{ code: '05D', description: null }] }
it('copies all context and moves only the requested membership', () => {
  const other = { ...p, id: 2 }
  const copied = transferProspect([p, other], 1, 'Territory', ' Visits ', false)
  expect(copied).toEqual([p, other, { ...p, list: 'Visits' }])
  expect(transferProspect([p, other], 1, 'Territory', 'Visits', true)).toEqual([other, { ...p, list: 'Visits' }])
})
it('refuses collisions, missing sources and invalid destinations without deleting work', () => {
  expect(transferProspect([p, { ...p, list: 'Visits', notes: 'Different' }], 1, 'Territory', 'Visits', true)).toBeNull()
  expect(transferProspect([p], 2, 'Territory', 'Visits', true)).toBeNull()
  expect(transferProspect([p], 1, 'Territory', ' ', true)).toBeNull()
})
it('defaults to copy and keeps the form available after a failed write', async () => {
  const onTransfer = vi.fn().mockReturnValue(false)
  render(<TransferProspect prospect={p} saved={[p]} onTransfer={onTransfer} />)
  await userEvent.click(screen.getByRole('button', { name: 'Copy or move to another list' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Destination list' }), 'Visits')
  await userEvent.click(screen.getByRole('button', { name: 'Copy restaurant' }))
  expect(onTransfer).toHaveBeenCalledWith('Visits', false)
  expect(screen.getByRole('textbox', { name: 'Destination list' })).toHaveValue('Visits')
})
