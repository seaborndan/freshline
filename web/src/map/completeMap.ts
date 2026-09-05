import { fetchMap, type MapRequest } from '../api/client'
import type { MapEstablishment, MapResult } from '../api/contract'

/** Split crowded areas instead of displaying a severity-biased sample. Requests are sequential
 * and cancellable; a capped recursion fails visibly rather than claiming an incomplete answer. */
export async function completeMap(request: MapRequest, signal?: AbortSignal): Promise<MapResult> {
  const items = new Map<number, MapEstablishment>()
  let requests = 0
  async function visit(current: MapRequest, depth: number): Promise<void> {
    signal?.throwIfAborted()
    if (++requests > 40 || depth > 12) throw new Error('This area is too dense to load completely. Zoom in to see all results.')
    const result = await fetchMap(current, signal)
    if (!result.isTruncated) {
      for (const item of result.items) items.set(item.id, item)
      return
    }
    const v = current.viewport
    const latitude = v.maxLatitude - v.minLatitude >= v.maxLongitude - v.minLongitude
    const mid = Number(((latitude ? v.minLatitude + v.maxLatitude : v.minLongitude + v.maxLongitude) / 2).toFixed(6))
    const low = latitude ? v.minLatitude : v.minLongitude
    const high = latitude ? v.maxLatitude : v.maxLongitude
    if (mid <= low || mid >= high) throw new Error('Too many places share this location. Narrow your filters.')
    await visit({ ...current, limit: 5000, viewport: { ...v, ...(latitude ? { maxLatitude: mid } : { maxLongitude: mid }) } }, depth + 1)
    await visit({ ...current, limit: 5000, viewport: { ...v, ...(latitude ? { minLatitude: mid } : { minLongitude: mid }) } }, depth + 1)
  }
  await visit(request, 0)
  return { items: [...items.values()], isTruncated: false }
}
