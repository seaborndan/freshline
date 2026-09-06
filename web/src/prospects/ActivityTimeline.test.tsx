import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityTimeline } from './ActivityTimeline'
it('appends a dated activity without replacing earlier entries', async () => {
  const activity = { id: 'old', date: '2026-01-01', kind: 'Note' as const, text: 'Original' }
  const onSave = vi.fn().mockReturnValue(true)
  render(<ActivityTimeline prospect={{ id:1, name:'Cafe', address:null, locality:null, phone:null, inspectedOn:'2026-01-01', evidence:[], source:'map', list:'A', stage:'To review', notes:'', activities:[activity] }} onSave={onSave} />)
  await userEvent.click(screen.getByText('Contact timeline (1)'))
  await userEvent.type(screen.getByRole('textbox', { name: 'Activity details' }), 'Visited and left samples')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Activity type' }), 'Visit')
  await userEvent.click(screen.getByRole('button', { name: 'Log activity' }))
  expect(onSave).toHaveBeenCalledWith([activity, expect.objectContaining({ kind:'Visit', text:'Visited and left samples' })])
})
