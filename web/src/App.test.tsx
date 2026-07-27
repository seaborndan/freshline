import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ApiProblemError, ApiUnreachableError } from './api/errors'
import type { MapResult } from './api/contract'
import { debounceMilliseconds } from './map/useEstablishments'
import mapFixture from './api/__fixtures__/map-viewport.json'

/**
 * MapLibre draws into a WebGL canvas, which jsdom does not have and will not get. Everything
 * decidable about the map lives in the plain modules beside it and is tested directly; what is left
 * here is the page — what it says while it waits, what it says when the API refuses, and whether it
 * asks about the box the map is actually showing.
 *
 * The double fires nothing by itself. The test decides when the style loads and when the map moves,
 * because those orderings are the whole difficulty — see MapView.test.tsx, written after a
 * synchronous double hid a real bug.
 */
const handlers = new Map<string, () => void>()

/** The box the fake map claims to be showing. Times Square, wider than the committed constant. */
let bounds = { south: 40.7515, north: 40.7605, west: -73.9925, east: -73.9785 }

vi.mock('maplibre-gl', () => ({
  Map: class {
    addControl = vi.fn()
    addSource = vi.fn()
    addLayer = vi.fn()
    getSource = () => undefined
    remove = vi.fn()
    getBounds = () => ({
      getSouth: () => bounds.south,
      getNorth: () => bounds.north,
      getWest: () => bounds.west,
      getEast: () => bounds.east,
    })
    on(event: string, handler: () => void) {
      handlers.set(event, handler)
    }
  },
  LngLatBounds: class {},
  NavigationControl: class {},
}))

const fetchMap = vi.hoisted(() => vi.fn())
vi.mock('./api/client', () => ({ fetchMap }))

const loaded = mapFixture as unknown as MapResult

/** The map settles on its opening box and announces it, then the debounce runs out. */
async function showMap() {
  await act(async () => {
    handlers.get('style.load')?.()
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(debounceMilliseconds)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  handlers.clear()
  bounds = { south: 40.7515, north: 40.7605, west: -73.9925, east: -73.9785 }
  fetchMap.mockReset()
  fetchMap.mockResolvedValue(loaded)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('asks for nothing until the map says where it is', async () => {
    render(<App />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(debounceMilliseconds * 3)
    })

    expect(fetchMap).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(/waiting for the map/i)
  })

  // The committed initial viewport is what the map opens on, not what is on screen: fitBounds fits
  // that box into whatever window the browser has, so the visible box is wider. Fetching the
  // constant would leave empty margins on a wide monitor.
  it('asks about the box the map reports, not the one it was told to open on', async () => {
    render(<App />)
    await showMap()

    const asked = (fetchMap.mock.calls[0][0] as { viewport: Record<string, number> }).viewport
    expect(asked.minLatitude).toBe(bounds.south)
    expect(asked.maxLatitude).toBe(bounds.north)
    expect(asked.minLongitude).toBe(bounds.west)
    expect(asked.maxLongitude).toBe(bounds.east)
  })

  it('re-asks when the map moves', async () => {
    render(<App />)
    await showMap()
    expect(fetchMap).toHaveBeenCalledTimes(1)

    bounds = { south: 40.72, north: 40.73, west: -73.99, east: -73.98 }
    await act(async () => {
      handlers.get('moveend')?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(debounceMilliseconds)
    })

    expect(fetchMap).toHaveBeenCalledTimes(2)
  })

  // Two numbers, not one. They match here — the five fixture establishments are at five different
  // addresses — and they do not match in the real data, where 518 establishments in the opening
  // viewport occupy 306 points. That gap is why the caption states both: a reader who counts dots
  // must not conclude the map is broken. The stacking itself is covered in geoJson.test.ts.
  it('reports both the number of places and the number of dots they draw as', async () => {
    render(<App />)
    await showMap()

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('5 places')
    expect(status).toHaveTextContent('at 5 points')
  })

  // Which rows a truncated response dropped is arbitrary, so a plain count would be a number the
  // data does not support — and the point count is withheld entirely, since it would describe an
  // arbitrary subset.
  it('never states a bare count from a truncated response', async () => {
    fetchMap.mockResolvedValue({ ...loaded, isTruncated: true })

    render(<App />)
    await showMap()

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/more than 5 places/i)
    expect(status).toHaveTextContent(/zoom in/i)
    expect(status).not.toHaveTextContent(/points/i)
  })

  it('distinguishes an empty view from a failure', async () => {
    fetchMap.mockResolvedValue({ items: [], isTruncated: false })

    render(<App />)
    await showMap()

    expect(screen.getByRole('status')).toHaveTextContent(/no establishments in this view/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // Reachable with two turns of a scroll wheel, and nothing has gone wrong — so it is an
  // instruction rather than an error, and no request is spent being told 400.
  it('asks the user to zoom in rather than sending a viewport the API refuses', async () => {
    bounds = { south: 39, north: 42, west: -76, east: -72 }

    render(<App />)
    await showMap()

    expect(fetchMap).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(/zoom in to load establishments/i)
  })

  it("reports the API's own sentence when it refuses", async () => {
    fetchMap.mockRejectedValue(
      new ApiProblemError(
        400,
        {
          title: 'Viewport too large',
          detail: 'A viewport may span at most 1 degrees on each axis.',
        },
        null,
      ),
    )

    render(<App />)
    await showMap()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A viewport may span at most 1 degrees on each axis.',
    )
  })

  it('says how long it is waiting when it is being throttled', async () => {
    fetchMap.mockRejectedValue(
      new ApiProblemError(429, { title: 'Too many requests', detail: 'Slow down.' }, 10),
    )

    render(<App />)
    await showMap()

    expect(screen.getByRole('alert')).toHaveTextContent(/waiting 10 seconds/i)
  })

  it('says the API is unreachable rather than showing an empty map', async () => {
    fetchMap.mockRejectedValue(new ApiUnreachableError(new TypeError('Failed to fetch')))

    render(<App />)
    await showMap()

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be reached/i)
  })

  it('shows the legend alongside the map', async () => {
    render(<App />)
    await showMap()

    expect(screen.getByRole('heading', { name: 'What the colours mean' })).toBeInTheDocument()
  })
})
