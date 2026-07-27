import { act, fireEvent, render, screen } from '@testing-library/react'
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
const fetchFilterOptions = vi.hoisted(() => vi.fn())
vi.mock('./api/client', () => ({ fetchMap, fetchFilterOptions }))

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
  fetchFilterOptions.mockReset()
  fetchFilterOptions.mockResolvedValue({
    cuisines: ['American', 'Chinese'],
    localities: ['Brooklyn', 'Manhattan'],
  })
  window.history.replaceState(null, '', '/')
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

  // The address bar is the state. What is in it when a link is opened is what the map shows, and
  // what the map shows ends up in it — that round trip is what makes the link worth sending.
  it('writes the viewport and the filters into the address bar', async () => {
    render(<App />)
    await showMap()

    const search = window.location.search
    expect(search).toContain('minLat=40.751500')
    expect(search).toContain('maxLon=-73.978500')
  })

  it('opens on the viewport in the address bar rather than the committed one', async () => {
    window.history.replaceState(
      null,
      '',
      '/?minLat=40.720000&maxLat=40.730000&minLon=-73.990000&maxLon=-73.980000&locality=Brooklyn',
    )

    render(<App />)
    await showMap()

    // The filter from the URL is applied to the very first request, not to the second one after a
    // render settles — otherwise a shared link flashes the unfiltered map first.
    expect((fetchMap.mock.calls[0][0] as { filter: unknown }).filter).toEqual({
      locality: 'Brooklyn',
    })
  })

  // fireEvent rather than userEvent here, and only here: userEvent schedules its own delays between
  // the events it synthesises, and those never resolve against the faked timers this file needs for
  // the debounce. FilterPanel.test.tsx drives the same control with userEvent, where there are no
  // fake timers to deadlock against.
  it('re-asks when a filter changes', async () => {
    render(<App />)
    await showMap()
    expect(fetchMap).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText('Borough'), { target: { value: 'Brooklyn' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(debounceMilliseconds)
    })

    expect(fetchMap).toHaveBeenCalledTimes(2)
    expect((fetchMap.mock.calls[1][0] as { filter: unknown }).filter).toEqual({
      locality: 'Brooklyn',
    })
    expect(window.location.search).toContain('locality=Brooklyn')
  })

  // Panning writes the URL constantly. pushState would make the back button an undo-my-panning key
  // and trap the user on the page.
  it('does not add a history entry for every movement', async () => {
    const pushState = vi.spyOn(window.history, 'pushState')

    render(<App />)
    await showMap()

    bounds = { south: 40.72, north: 40.73, west: -73.99, east: -73.98 }
    await act(async () => {
      handlers.get('moveend')?.()
    })

    expect(pushState).not.toHaveBeenCalled()
  })
})
