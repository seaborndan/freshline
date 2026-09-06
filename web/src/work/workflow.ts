import type { EstablishmentDetail } from '../api/contract'
import type { SavedProspect } from '../prospects/model'
import { parsePlainDate } from '../api/plainDate'
import { localToday } from '../prospects/workspace'

export function snapshotChanged(saved: SavedProspect, detail: EstablishmentDetail): boolean {
  const latest = detail.inspections[0]
  if (!latest) return saved.inspectedOn !== ''
  if (latest.inspectedOn !== saved.inspectedOn) return true
  const current = new Set(latest.violations.map(v => v.code))
  if (saved.evidence.some(v => !current.has(v.code))) return true
  // Category discovery stores only matching codes, so additional codes in the full record
  // are not evidence of a change. Map saves retain the complete citation snapshot.
  return saved.source === 'map' && current.size !== new Set(saved.evidence.map(v => v.code)).size
}
export interface VisitPlan { date: string; ids: number[] }
export function readVisitPlan(raw: string | null): VisitPlan {
  if (raw === null) return { date: localToday(), ids: [] }
  const p = JSON.parse(raw)
  if (!p || typeof p.date !== 'string' || !parsePlainDate(p.date) || !Array.isArray(p.ids) || p.ids.length > 10000 || !p.ids.every((id: unknown) => Number.isInteger(id) && Number(id) > 0) || new Set(p.ids).size !== p.ids.length) throw new Error('Invalid visit plan')
  return p
}
