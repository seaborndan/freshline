import { parsePlainDate } from '../api/plainDate'
import type { SavedProspect } from './model'

export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function isDue(p: SavedProspect, today: string): boolean {
  return p.stage !== 'Not a fit' && !!p.followUpOn && p.followUpOn <= today
}

export function savedMatches(p: SavedProspect, search: string, stage: string, dueOnly: boolean, today: string): boolean {
  const text = `${p.name} ${p.address ?? ''} ${p.locality ?? ''} ${p.notes}`.toLocaleLowerCase()
  return text.includes(search.trim().toLocaleLowerCase()) && (!stage || p.stage === stage) && (!dueOnly || isDue(p, today))
}

export interface DiscoverySearch { category: string; locality: string; from: string; to: string }

export function readDiscovery(search: string, now = new Date()): DiscoverySearch {
  const query = new URLSearchParams(search)
  const start = new Date(now)
  start.setDate(start.getDate() - 180)
  const from = query.get('from') ?? ''
  const to = query.get('to') ?? ''
  const validRange = parsePlainDate(from) && parsePlainDate(to) && from <= to
  return { category: query.get('category') || 'all', locality: query.get('locality') ?? '',
    from: validRange ? from : localToday(start), to: validRange ? to : localToday(now) }
}

export function workspaceQuery(discovery: DiscoverySearch, list?: string): string {
  const query = new URLSearchParams({ ...discovery })
  if (list !== undefined) query.set('list', list)
  return `?${query}`
}

/** Existing work wins on conflicts, including its notes and follow-up date. */
export function mergeBackup(existing: SavedProspect[], incoming: SavedProspect[]): SavedProspect[] {
  const result = [...existing]
  for (const p of incoming) {
    if (!result.some(s => s.id === p.id && s.list === p.list)) result.push(p)
  }
  return result
}
