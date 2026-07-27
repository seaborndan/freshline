import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapResult } from '../api/contract'
import { ApiProblemError } from '../api/errors'
import type { Viewport } from '../api/viewport'
import { debounceMilliseconds, useEstablishments } from './useEstablishments'

const fetchMap = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ fetchMap }))

const timesSquare: Viewport = {
  minLatitude: 40.752,
  maxLatitude: 40.76,
  minLongitude: -73.9908,
  maxLongitude: -73.9802,
}

/** A different box, far enough that it rounds differently at six decimal places. */
const eastVillage: Viewport = {
  minLatitude: 40.721,
  maxLatitude: 40.733,
  minLongitude: -73.9939,
  maxLongitude: -73.9781,
}

const emptyResult: MapResult = { items: [], isTruncated: false }

/**
 * Runs out the debounce and lets the resulting promise settle.
 *
 * `advanceTimersByTimeAsync` yields to the microtask queue, so the fetch's `then`/`catch` have run
 * by the time this returns and state can be asserted directly. Testing Library's `waitFor` is the
 * wrong tool here — it polls on real timers and deadlocks against faked ones.
 */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(debounceMilliseconds)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMap.mockReset()
  fetchMap.mockResolvedValue(emptyResult)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useEstablishments', () => {
  it('asks for nothing until the map says where it is', async () => {
    renderHook(() => useEstablishments(null))

    await settle()

    expect(fetchMap).not.toHaveBeenCalled()
  })

  it('waits for the debounce before asking', async () => {
    renderHook(() => useEstablishments(timesSquare))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(debounceMilliseconds - 50)
    })
    expect(fetchMap).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(fetchMap).toHaveBeenCalledTimes(1)
  })

  // The reason the debounce exists. A user dragging across the city produces a run of viewports,
  // and only the last one is a question worth asking — the rest describe boxes nobody is looking
  // at any more. The rate limiter refills three tokens a second and shares one bucket with the
  // detail endpoint, so the intermediate requests are not free.
  it('sends one request for a run of viewports, for the last one', async () => {
    const { rerender } = renderHook(({ viewport }) => useEstablishments(viewport), {
      initialProps: { viewport: timesSquare },
    })

    for (const step of [0.001, 0.002, 0.003]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      rerender({ viewport: { ...timesSquare, minLatitude: timesSquare.minLatitude + step } })
    }

    await settle()

    expect(fetchMap).toHaveBeenCalledTimes(1)
    expect((fetchMap.mock.calls[0][0] as { viewport: Viewport }).viewport.minLatitude).toBeCloseTo(
      timesSquare.minLatitude + 0.003,
    )
  })

  it('cancels a request that a newer viewport has superseded', async () => {
    const { rerender } = renderHook(({ viewport }) => useEstablishments(viewport), {
      initialProps: { viewport: timesSquare },
    })

    await settle()
    const firstSignal = (fetchMap.mock.calls[0][1] ?? {}) as AbortSignal
    expect(firstSignal.aborted).toBe(false)

    rerender({ viewport: eastVillage })
    await settle()

    expect(firstSignal.aborted).toBe(true)
    expect(fetchMap).toHaveBeenCalledTimes(2)
  })

  // A click that does not move the camera, or a zoom that lands back where it started, still fires
  // moveend. Comparison is on the rounded coordinates that go on the wire, so "changed" means
  // "would produce a different request".
  it('does not re-ask the same question', async () => {
    const { rerender } = renderHook(({ viewport }) => useEstablishments(viewport), {
      initialProps: { viewport: timesSquare },
    })

    await settle()
    rerender({ viewport: { ...timesSquare } })
    await settle()

    expect(fetchMap).toHaveBeenCalledTimes(1)
  })

  it('ignores a movement too small to change the request', async () => {
    const { rerender } = renderHook(({ viewport }) => useEstablishments(viewport), {
      initialProps: { viewport: timesSquare },
    })

    await settle()
    // A tenth of a millimetre. Below the sixth decimal place, so the query string is identical.
    rerender({ viewport: { ...timesSquare, minLatitude: timesSquare.minLatitude + 1e-9 } })
    await settle()

    expect(fetchMap).toHaveBeenCalledTimes(1)
  })

  // The API refuses a viewport wider than a degree, and the whole dataset spans 0.41° by 0.55° —
  // so this is a user who has zoomed past the entire city. Spending a rate-limit token to be told
  // 400 is waste.
  it('does not send a viewport the API is known to refuse', async () => {
    const { result } = renderHook(() =>
      useEstablishments({ ...timesSquare, maxLatitude: timesSquare.minLatitude + 2 }),
    )

    await settle()

    expect(fetchMap).not.toHaveBeenCalled()
    expect(result.current.unaskable).toMatch(/at most 1 degrees/)
  })

  it('keeps the pins on screen while the next viewport loads', async () => {
    const loaded: MapResult = {
      items: [
        {
          id: 1,
          name: 'RAISING CANES #888',
          latitude: 40.757,
          longitude: -73.986,
          isAwaitingFirstInspection: false,
          latestInspection: {
            inspectedOn: '2025-11-20',
            rawGrade: 'A',
            outcome: 'Good',
            normalisedSeverity: 9,
            closedByAuthority: false,
          },
        },
      ],
      isTruncated: false,
    }
    fetchMap.mockResolvedValue(loaded)

    const { result, rerender } = renderHook(({ viewport }) => useEstablishments(viewport), {
      initialProps: { viewport: timesSquare },
    })

    await settle()
    expect(result.current.result?.items).toHaveLength(1)

    // A slow second request. The old pins must not be cleared, because an empty map is
    // indistinguishable from an area with nothing in it.
    fetchMap.mockReturnValue(new Promise(() => {}))
    rerender({ viewport: eastVillage })
    await settle()

    expect(result.current.isLoading).toBe(true)
    expect(result.current.result?.items).toHaveLength(1)
  })

  // The 429 is a normal response on a map, not an exceptional one. Nothing retries — what this
  // does is decline to *send* until the limiter would accept it, so a user panning through a
  // cooldown collects one refusal rather than a dozen.
  it('holds off until the Retry-After has elapsed, without retrying', async () => {
    fetchMap.mockRejectedValueOnce(
      new ApiProblemError(429, { title: 'Too many requests', detail: 'Slow down.' }, 10),
    )

    const { result, rerender } = renderHook(({ viewport }) => useEstablishments(viewport), {
      initialProps: { viewport: timesSquare },
    })

    await settle()
    expect(result.current.failure?.retryAfterSeconds).toBe(10)
    expect(fetchMap).toHaveBeenCalledTimes(1)

    // The user keeps moving. Nothing goes out while the cooldown is running.
    rerender({ viewport: eastVillage })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(fetchMap).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(fetchMap).toHaveBeenCalledTimes(2)
  })

  // Otherwise one failure would make that box permanently unfetchable for as long as the user
  // stayed on it — the retry has to be reachable by asking the same question again.
  it('allows the same viewport to be asked again after a failure', async () => {
    fetchMap.mockRejectedValueOnce(
      new ApiProblemError(500, { title: 'Server error', detail: 'Something broke.' }, null),
    )

    const { result, rerender } = renderHook(({ viewport }) => useEstablishments(viewport), {
      initialProps: { viewport: timesSquare },
    })

    await settle()
    expect(result.current.failure).not.toBeNull()

    rerender({ viewport: eastVillage })
    await settle()
    rerender({ viewport: timesSquare })
    await settle()

    expect(fetchMap).toHaveBeenCalledTimes(3)
  })

  it('clears a failure once a request succeeds', async () => {
    fetchMap.mockRejectedValueOnce(
      new ApiProblemError(500, { title: 'Server error', detail: 'Something broke.' }, null),
    )

    const { result, rerender } = renderHook(({ viewport }) => useEstablishments(viewport), {
      initialProps: { viewport: timesSquare },
    })

    await settle()
    expect(result.current.failure).not.toBeNull()

    rerender({ viewport: eastVillage })
    await settle()

    expect(result.current.failure).toBeNull()
  })
})
