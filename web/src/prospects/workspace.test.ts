import { expect, it } from 'vitest'
import { isDue, localToday, mergeBackup, readDiscovery, savedMatches, workspaceQuery } from './workspace'
import { readSaved, type SavedProspect } from './model'
const record: SavedProspect = { id: 1, name: 'Cafe One', list: 'Queens', stage: 'Follow up', notes: 'Ask about soap supplies', address: '1 Main St', locality: 'Queens', phone: null, inspectedOn: '2026-07-01', evidence: [{ code: '05D', description: null }] }
it('keeps old saved records compatible and validates optional follow-up dates', () => {
  expect(readSaved(JSON.stringify([record]))).toEqual([record])
  expect(() => readSaved(JSON.stringify([{ ...record, followUpOn: '2026-02-30' }]))).toThrow()
})
it('counts today and overdue dates, excluding future dates and rejected prospects', () => {
  expect(isDue({ ...record, followUpOn: '2026-09-05' }, '2026-09-05')).toBe(true)
  expect(isDue({ ...record, followUpOn: '2026-09-04' }, '2026-09-05')).toBe(true)
  expect(isDue({ ...record, followUpOn: '2026-09-06' }, '2026-09-05')).toBe(false)
  expect(isDue({ ...record, followUpOn: '2026-09-04', stage: 'Not a fit' }, '2026-09-05')).toBe(false)
  expect(localToday(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05')
})
it('searches notes and combines status with due filters', () => {
  expect(savedMatches(record, 'SOAP', 'Follow up', false, '2026-09-05')).toBe(true)
  expect(savedMatches(record, 'SOAP', 'Contacted', false, '2026-09-05')).toBe(false)
  expect(savedMatches(record, '', '', true, '2026-09-05')).toBe(false)
})
it('merges backups without replacing existing notes or duplicating memberships', () => {
  const incoming = [{ ...record, notes: 'Older note' }, { ...record, list: 'Manhattan' }, { ...record, list: 'Manhattan' }]
  expect(mergeBackup([record], incoming)).toEqual([record, incoming[1]])
})
it('round-trips submitted discovery and safely encodes list names', () => {
  const search = { category: 'sanitation', locality: 'Queens', from: '2026-06-01', to: '2026-07-01' }
  const query = workspaceQuery(search, 'A & B')
  expect(readDiscovery(query)).toEqual(search)
  expect(new URLSearchParams(query).get('list')).toBe('A & B')
  expect(readDiscovery('?from=broken&to=2026-07-01', new Date(2026, 8, 5)).to).toBe('2026-09-05')
})
