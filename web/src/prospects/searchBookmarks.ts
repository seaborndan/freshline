import { parsePlainDate } from '../api/plainDate'
import type { DiscoverySearch } from './workspace'
import { localToday } from './workspace'

export interface SavedSearch extends DiscoverySearch { name: string; rollingDays?: number }
export function resolveSearch(search: SavedSearch, now = new Date()): DiscoverySearch {
  if (!search.rollingDays) return { category: search.category, locality: search.locality, from: search.from, to: search.to }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // Both API boundaries are inclusive, so today plus the preceding N-1 calendar days is N days.
  start.setDate(start.getDate() - search.rollingDays + 1)
  return { category: search.category, locality: search.locality, from: localToday(start), to: localToday(now) }
}
export const searchStorageKey = 'freshline.searches.v1'
export function readSearches(raw: string | null): SavedSearch[] {
  if (raw === null) return []
  const rows: unknown = JSON.parse(raw)
  if (!Array.isArray(rows) || rows.length > 50 || !rows.every(p => p && typeof p.name === 'string' &&
    p.name.trim() && p.name.length <= 80 && typeof p.category === 'string' && typeof p.locality === 'string' &&
    typeof p.from === 'string' && typeof p.to === 'string' && parsePlainDate(p.from) && parsePlainDate(p.to) && p.from <= p.to &&
    (p.rollingDays === undefined || [7, 30, 90, 180].includes(p.rollingDays))) ||
    new Set(rows.map(p => p.name)).size !== rows.length) throw new Error('Saved searches could not be read. Existing data has not been changed.')
  return rows as SavedSearch[]
}
