import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ApiProblemError, ApiUnreachableError } from './api/errors'
import type { MapResult } from './api/contract'
import mapFixture from './api/__fixtures__/map-viewport.json'

/**
 * MapLibre draws into a WebGL canvas, which jsdom does not have and will not get. Mocking the
 * library is not a way of avoiding a hard test — everything decidable about the map is in the plain
 * modules beside it (`geoJson.ts`, `pinStyle.ts`, `layers.ts`), and those are tested directly. What
 * is left here is the page: what it says while loading, what it says when the API refuses, and
 * whether the legend is present.
 *
 * The stub fires `style.load` synchronously, which is convenient and is NOT the ordering a browser
 * produces — see MapView.test.tsx, which owns that question and was written after the synchronous
 * double hid a real bug. What this stub is for is the page around the map.
 */
const setData = vi.fn()
const addLayer = vi.fn()
const addSource = vi.fn()
const remove = vi.fn()

vi.mock('maplibre-gl', () => ({
  Map: class {
    addControl = vi.fn()
    addSource = addSource
    addLayer = addLayer
    getSource = () => ({ setData })
    remove = remove
    on(event: string, handler: () => void) {
      // The real component listens for 'style.load' rather than 'load' — see the comment in
      // MapView.tsx. If that ever changes back, these tests stop proving the layers are added.
      if (event === 'style.load') {
        handler()
      }
    }
  },
  // No constructor parameter properties: `erasableSyntaxOnly` is on, so any TypeScript that would
  // emit runtime code is a compile error — including in a test double.
  LngLatBounds: class {
    southWest: [number, number]
    northEast: [number, number]

    constructor(southWest: [number, number], northEast: [number, number]) {
      this.southWest = southWest
      this.northEast = northEast
    }
  },
  NavigationControl: class {},
}))

const fetchMap = vi.hoisted(() => vi.fn())
vi.mock('./api/client', () => ({ fetchMap }))

const loaded = mapFixture as unknown as MapResult

beforeEach(() => {
  fetchMap.mockReset()
  setData.mockClear()
  addLayer.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  it('says it is loading before the first response arrives', () => {
    fetchMap.mockReturnValue(new Promise(() => {}))

    render(<App />)

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
  })

  it('reports how many places are in view once they arrive', async () => {
    fetchMap.mockResolvedValue(loaded)

    render(<App />)

    expect(await screen.findByText(/5 places around Times Square/)).toBeInTheDocument()
  })

  it('draws the pins it was given', async () => {
    fetchMap.mockResolvedValue(loaded)

    render(<App />)
    await screen.findByText(/5 places/)

    expect(addSource).toHaveBeenCalled()
    // Two layers over one source: the ordinary pins, and the ones that must not be painted over.
    expect(addLayer).toHaveBeenCalledTimes(2)
  })

  it('shows the legend alongside the map', async () => {
    fetchMap.mockResolvedValue(loaded)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'What the colours mean' })).toBeInTheDocument()
  })

  // The rule from the milestone decisions: which rows a truncated response dropped is arbitrary, so
  // a plain count would be a number the data does not support. "At least" is the strongest true
  // claim available.
  it('never states a bare count from a truncated response', async () => {
    fetchMap.mockResolvedValue({ ...loaded, isTruncated: true })

    render(<App />)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/at least 5 places/i)
    expect(status).toHaveTextContent(/zoom in/i)
  })

  it('distinguishes an empty area from a failure', async () => {
    fetchMap.mockResolvedValue({ items: [], isTruncated: false })

    render(<App />)

    expect(await screen.findByText(/no establishments in this area/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("reports the API's own sentence when it refuses", async () => {
    fetchMap.mockRejectedValue(
      new ApiProblemError(400, { title: 'Viewport too large', detail: 'A viewport may span at most 1 degrees on each axis.' }, null),
    )

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A viewport may span at most 1 degrees on each axis.',
    )
  })

  // The 429 is a normal response on a map, and the one thing a user can act on is when to come back.
  it('says how long to wait when it is being throttled', async () => {
    fetchMap.mockRejectedValue(
      new ApiProblemError(429, { title: 'Too many requests', detail: 'Slow down.' }, 10),
    )

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/try again in 10 seconds/i)
  })

  it('says the API is unreachable rather than showing an empty map', async () => {
    fetchMap.mockRejectedValue(new ApiUnreachableError(new TypeError('Failed to fetch')))

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be reached/i)
  })
})
