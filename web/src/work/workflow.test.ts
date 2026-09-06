import { expect, it } from 'vitest'
import { readVisitPlan, snapshotChanged } from './workflow'
import { readSaved, readProspects, type SavedProspect } from '../prospects/model'
import type { EstablishmentDetail } from '../api/contract'
const saved: SavedProspect = { id: 1, name: 'Cafe', address: null, locality: null, phone: null, inspectedOn: '2026-07-01', evidence: [{ code: '04L', description: null }], list: 'A', notes: '', stage: 'To review' }
const detail: EstablishmentDetail = { id: 1, name: 'Cafe', addressLine: null, locality: null, phone: null, cuisine: null, postalCode: null, latitude: null, longitude: null, isAwaitingFirstInspection: false, inspections: [{ id: 1, inspectedOn: '2026-07-01', inspectionType: null, action: null, rawGrade: null, rawScore: null, outcome: 'Ungraded', normalisedSeverity: null, closedByAuthority: false, violations: [{ code: '04L', description: null, isCritical: null }, { code: '10F', description: null, isCritical: false }] }] }
it('does not mistake category-specific evidence for a changed full record', () => {
  expect(snapshotChanged(saved,detail)).toBe(false)
  expect(snapshotChanged({ ...saved, source: 'map' },detail)).toBe(true)
  expect(snapshotChanged({ ...saved, inspectedOn: '2026-06-01' },detail)).toBe(true)
  expect(snapshotChanged({ ...saved, evidence: [{ code: '05D', description: null }] },detail)).toBe(true)
})
it('allows general map saves with no inspection without relaxing discovery validation', () => {
  const general = { ...saved, source: 'map', inspectedOn: '', evidence: [], activities: [{ id: 'a', date: '2026-07-01', kind: 'Visit', text: 'Met manager' }] }
  expect(readSaved(JSON.stringify([general]))).toEqual([general])
  expect(() => readProspects({ items: [general], isTruncated: false })).toThrow()
  expect(() => readSaved(JSON.stringify([{ ...general, activities: [{ id: 'a', date: '2026-02-30', kind: 'Visit', text: 'bad date' }] }]))).toThrow()
})
it('rejects corrupt plans and duplicate stops', () => {
  expect(readVisitPlan(JSON.stringify({ date: '2026-09-06', ids: [2,1] })).ids).toEqual([2,1])
  expect(() => readVisitPlan(JSON.stringify({ date: '2026-09-06', ids: [1,1] }))).toThrow()
  expect(() => readVisitPlan(JSON.stringify({ date: '', ids: [] }))).toThrow()
})
