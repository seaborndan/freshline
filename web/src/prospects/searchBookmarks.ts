import { parsePlainDate } from '../api/plainDate'
import type { DiscoverySearch } from './workspace'

export interface SavedSearch extends DiscoverySearch { name: string }
export const searchStorageKey = 'freshline.searches.v1'
export function readSearches(raw: string | null): SavedSearch[] {
  if (raw === null) return []
  const rows: unknown = JSON.parse(raw)
  if (!Array.isArray(rows) || rows.length > 50 || !rows.every(p => p && typeof p.name === 'string' &&
    p.name.trim() && p.name.length <= 80 && typeof p.category === 'string' && typeof p.locality === 'string' &&
    typeof p.from === 'string' && typeof p.to === 'string' && parsePlainDate(p.from) && parsePlainDate(p.to) && p.from <= p.to) ||
    new Set(rows.map(p => p.name)).size !== rows.length) throw new Error('Saved searches could not be read. Existing data has not been changed.')
  return rows as SavedSearch[]
}
