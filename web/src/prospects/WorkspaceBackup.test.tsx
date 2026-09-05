import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { WorkspaceBackup } from './WorkspaceBackup'
import type { SavedProspect } from './model'
const saved: SavedProspect = { id: 1, name: 'Cafe', address: null, locality: null, phone: null, inspectedOn: '2026-06-01', evidence: [{ code: '04L', description: null }], list: 'My list', stage: 'Follow up', notes: 'Keep my note', followUpOn: '2026-09-08' }
function file(body: unknown) {
  const text = JSON.stringify(body)
  const result = new File([text], 'backup.json', { type: 'application/json' })
  // jsdom's File does not provide Blob.text in every supported runtime.
  Object.defineProperty(result, 'text', { value: async () => text })
  return result
}
it('previews new records and preserves existing notes before explicit restore', async () => {
  const restore = vi.fn().mockReturnValue(true)
  const user = userEvent.setup()
  render(<WorkspaceBackup saved={[saved]} onRestore={restore} />)
  await user.click(screen.getByText('Backup & restore'))
  await user.upload(screen.getByLabelText('Choose backup file'), file({ format: 'freshline-workspace', version: 1, saved: [{ ...saved, notes: 'old' }, { ...saved, id: 2 }] }))
  expect(await screen.findByText(/1 new saved records/)).toBeInTheDocument()
  expect(restore).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Restore new records' }))
  expect(restore).toHaveBeenCalledWith([saved, { ...saved, id: 2 }])
})
it('rejects incompatible backups without changing saved work', async () => {
  const restore = vi.fn()
  const user = userEvent.setup()
  render(<WorkspaceBackup saved={[saved]} onRestore={restore} />)
  await user.click(screen.getByText('Backup & restore'))
  await user.upload(screen.getByLabelText('Choose backup file'), file({ format: 'freshline-workspace', version: 99, saved: [] }))
  expect(await screen.findByRole('status')).toHaveTextContent('version 1')
  expect(restore).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Restore new records' })).not.toBeInTheDocument()
})
