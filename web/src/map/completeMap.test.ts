import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMap } from '../api/client'
import { completeMap } from './completeMap'
import type { MapEstablishment } from '../api/contract'
vi.mock('../api/client', () => ({ fetchMap: vi.fn() }))
const fetch = vi.mocked(fetchMap)
const viewport = { minLatitude: 40, maxLatitude: 40.4, minLongitude: -74, maxLongitude: -73.8 }
const pin = (id: number) => ({ id } as MapEstablishment)
beforeEach(() => fetch.mockReset())
describe('complete viewport loading', () => {
  it('discards the biased parent sample and deduplicates shared boundary records', async () => {
    fetch.mockResolvedValueOnce({ items: [pin(999)], isTruncated: true })
      .mockResolvedValueOnce({ items: [pin(1), pin(2)], isTruncated: false })
      .mockResolvedValueOnce({ items: [pin(2), pin(3)], isTruncated: false })
    const result = await completeMap({ viewport })
    expect(result.items.map(p => p.id)).toEqual([1, 2, 3])
    expect(result.isTruncated).toBe(false)
    expect(fetch.mock.calls[1][0].viewport.maxLatitude).toBe(fetch.mock.calls[2][0].viewport.minLatitude)
  })
  it('does not publish a partial answer if one partition fails', async () => {
    fetch.mockResolvedValueOnce({ items: [], isTruncated: true })
      .mockResolvedValueOnce({ items: [pin(1)], isTruncated: false })
      .mockRejectedValueOnce(new Error('offline'))
    await expect(completeMap({ viewport })).rejects.toThrow('offline')
  })
  it('stops before sending another request when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(completeMap({ viewport }, controller.signal)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('bounds the work for an area that never becomes complete', async () => {
    fetch.mockResolvedValue({ items: [], isTruncated: true })
    await expect(completeMap({ viewport })).rejects.toThrow(/dense|location/)
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(40)
  })
})
