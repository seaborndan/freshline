export interface Prospect {
  id: number
  name: string
  address: string | null
  locality: string | null
  phone: string | null
  inspectedOn: string
  evidence: { code: string; description: string | null }[]
}
export interface ProspectResult { items: Prospect[]; isTruncated: boolean }
export interface OpportunityCategory { id: string; label: string; description: string; codes: string[] }

export function readCategories(value: unknown): OpportunityCategory[] {
  if (!Array.isArray(value) || !value.every(c => c && typeof c.id === 'string' &&
    typeof c.label === 'string' && typeof c.description === 'string' &&
    Array.isArray(c.codes) && c.codes.every((code: unknown) => typeof code === 'string'))) {
    throw new Error('Opportunity categories could not be read.')
  }
  return value
}
export const stages = ['To review', 'Contacted', 'Follow up', 'Not a fit'] as const
export type Stage = typeof stages[number]
export interface SavedProspect extends Prospect { list: string; stage: Stage; notes: string }
export const storageKey = 'freshline.prospects.v1'

export function isProspect(value: unknown): value is Prospect {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return Number.isInteger(p.id) && Number(p.id) > 0 && typeof p.name === 'string' &&
    ['address', 'locality', 'phone'].every(k => p[k] === null || typeof p[k] === 'string') &&
    typeof p.inspectedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.inspectedOn) &&
    Array.isArray(p.evidence) && p.evidence.length > 0 && p.evidence.every(e =>
      typeof e === 'object' && e !== null && typeof e.code === 'string' &&
      (e.description === null || typeof e.description === 'string'))
}
export function readProspects(value: unknown): ProspectResult {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid prospect response.')
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.items) || !result.items.every(isProspect) || typeof result.isTruncated !== 'boolean') {
    throw new Error('The prospect response is incomplete or invalid.')
  }
  return { items: result.items, isTruncated: result.isTruncated }
}
export function readSaved(raw: string | null): SavedProspect[] {
  if (raw === null) return []
  const data: unknown = JSON.parse(raw)
  if (!Array.isArray(data) || !data.every(p => {
    const saved = p as Partial<SavedProspect> | null
    return isProspect(p) && saved !== null && typeof saved.list === 'string' &&
      typeof saved.notes === 'string' && stages.includes(saved.stage as Stage)
  })) {
    throw new Error('Saved lists could not be read. Existing browser data has not been changed.')
  }
  return data as SavedProspect[]
}
