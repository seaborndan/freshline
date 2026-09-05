import { agendaRows, visitBrief } from './fieldwork'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { FollowUpAgenda } from './FollowUpAgenda'
import { VisitBrief } from './VisitBrief'
import type { SavedProspect } from './model'

const record: SavedProspect = { id: 1, name: 'Cafe One', list: 'Queens', stage: 'Follow up', notes: 'Ask about soap supplies', address: '1 Main St', locality: 'Queens', phone: null, inspectedOn: '2026-07-01', evidence: [{ code: '05D', description: null }], followUpOn: '2026-09-05' }
it('prioritizes oldest dates across lists and preserves independent memberships', () => {
  const earlier = { ...record, list: 'Another list', followUpOn: '2026-09-01' }
  const input = [record, { ...record, id: 2, followUpOn: '2026-09-06' }, earlier, { ...record, id: 3, stage: 'Not a fit' as const }, { ...record, id: 4, followUpOn: '' }]
  expect(agendaRows(input, '2026-09-05')).toEqual([earlier, record])
  expect(input[0]).toBe(record)
})
it('opens the precise restaurant and list from the agenda', async () => {
  const onOpen = vi.fn()
  render(<FollowUpAgenda saved={[record]} today="2026-09-05" onOpen={onOpen} />)
  await userEvent.click(screen.getByText('Across your lists · 1 due follow-ups'))
  await userEvent.click(screen.getByRole('button', { name: 'Open saved record for Cafe One in Queens' }))
  expect(onOpen).toHaveBeenCalledWith(record)
})
it('exports only supplied filtered records, retaining literal notes and source dates', () => {
  const text = visitBrief([{ ...record, notes: '<script>literal notes</script>\nsecond line' }], 'Queens', '2026-09-05')
  expect(text).toContain('1 saved places in the current filtered view')
  expect(text).toContain('Inspection snapshot: 2026-07-01')
  expect(text).toContain('05D: No description published')
  expect(text).toContain('<script>literal notes</script>\nsecond line')
  expect(text).toContain('not proof of a current problem')
  expect(text).toContain('Phone: Not published')
})
it('does not offer an empty brief download', () => {
  render(<VisitBrief rows={[]} list="Queens" />)
  expect(screen.getByRole('button', { name: 'Download visit brief' })).toBeDisabled()
})
