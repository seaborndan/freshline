import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapPage } from './MapPage'
import { ApiProblemError, ApiUnreachableError } from '../api/errors'
import type { MapResult } from '../api/contract'
import { debounceMilliseconds } from './useEstablishments'
import mapFixture from '../api/__fixtures__/map-viewport.json'

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

/** Camera moves the map was asked to make. */
const easeTo = vi.hoisted(() => vi.fn())

/** The box the fake map claims to be showing. Times Square, wider than the committed constant. */
let bounds = { south: 40.7515, north: 40.7605, west: -73.9925, east: -73.9785 }

/** What the fake map reports as being under the next click. */
let clicked: { properties: { id: number } }[] = []

vi.mock('maplibre-gl', () => ({
  Map: class {
    addControl = vi.fn()
    addSource = vi.fn()
    addLayer = vi.fn()
    getSource = () => undefined
    remove = vi.fn()
    isMoving = () => false
    // Enough of a style for the label-quietening pass to walk; MapView.test.tsx is where that
    // behaviour is actually asserted.
    getStyle = () => ({ layers: [{ id: 'place-label', type: 'symbol' }] })
    setLayerZoomRange = vi.fn()
    setLayoutProperty = vi.fn()
    getCanvas = () => ({ style: {} })
    getZoom = () => 15
    easeTo = easeTo
    queryRenderedFeatures = () => clicked
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
const fetchEstablishment = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ fetchMap, fetchFilterOptions, fetchEstablishment }))

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
  clicked = []
  easeTo.mockClear()
  fetchMap.mockReset()
  fetchMap.mockResolvedValue(loaded)
  fetchEstablishment.mockReset()
  fetchEstablishment.mockResolvedValue({
    id: 1328,
    name: 'RAISING CANES #888',
    cuisine: 'Chicken',
    phone: null,
    addressLine: '1 FIXTURE STREET',
    locality: 'Manhattan',
    postalCode: '10001',
    latitude: 40.757,
    longitude: -73.986,
    isAwaitingFirstInspection: false,
    inspections: [],
  })
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

describe('MapPage', () => {
  it('asks for nothing until the map says where it is', async () => {
    render(<MapPage />)

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
    render(<MapPage />)
    await showMap()

    const asked = (fetchMap.mock.calls[0][0] as { viewport: Record<string, number> }).viewport
    expect(asked.minLatitude).toBe(bounds.south)
    expect(asked.maxLatitude).toBe(bounds.north)
    expect(asked.minLongitude).toBe(bounds.west)
    expect(asked.maxLongitude).toBe(bounds.east)
  })

  it('re-asks when the map moves', async () => {
    render(<MapPage />)
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
    render(<MapPage />)
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

    render(<MapPage />)
    await showMap()

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/more than 5 places/i)
    expect(status).toHaveTextContent(/zoom in/i)
    expect(status).not.toHaveTextContent(/points/i)
  })

  it('distinguishes an empty view from a failure', async () => {
    fetchMap.mockResolvedValue({ items: [], isTruncated: false })

    render(<MapPage />)
    await showMap()

    expect(screen.getByRole('status')).toHaveTextContent(/no establishments in this view/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // Reachable with two turns of a scroll wheel, and nothing has gone wrong — so it is an
  // instruction rather than an error, and no request is spent being told 400.
  it('asks the user to zoom in rather than sending a viewport the API refuses', async () => {
    bounds = { south: 39, north: 42, west: -76, east: -72 }

    render(<MapPage />)
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

    render(<MapPage />)
    await showMap()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A viewport may span at most 1 degrees on each axis.',
    )
  })

  it('says how long it is waiting when it is being throttled', async () => {
    fetchMap.mockRejectedValue(
      new ApiProblemError(429, { title: 'Too many requests', detail: 'Slow down.' }, 10),
    )

    render(<MapPage />)
    await showMap()

    expect(screen.getByRole('alert')).toHaveTextContent(/waiting 10 seconds/i)
  })

  it('says the API is unreachable rather than showing an empty map', async () => {
    fetchMap.mockRejectedValue(new ApiUnreachableError(new TypeError('Failed to fetch')))

    render(<MapPage />)
    await showMap()

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be reached/i)
  })

  it('shows the legend alongside the map', async () => {
    render(<MapPage />)
    await showMap()

    expect(screen.getByRole('heading', { name: 'What the colours mean' })).toBeInTheDocument()
  })

  // The address bar is the state. What is in it when a link is opened is what the map shows, and
  // what the map shows ends up in it — that round trip is what makes the link worth sending.
  it('writes the viewport and the filters into the address bar', async () => {
    render(<MapPage />)
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

    render(<MapPage />)
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
    render(<MapPage />)
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

    render(<MapPage />)
    await showMap()

    bounds = { south: 40.72, north: 40.73, west: -73.99, east: -73.98 }
    await act(async () => {
      handlers.get('moveend')?.()
    })

    expect(pushState).not.toHaveBeenCalled()
  })

  /** Fires the map's click handler with whatever `clicked` currently holds. */
  async function clickMap() {
    await act(async () => {
      ;(handlers.get('click') as unknown as (event: { point: unknown }) => void)?.({ point: {} })
    })
  }

  it('opens the record when a click lands on one establishment', async () => {
    render(<MapPage />)
    await showMap()

    clicked = [{ properties: { id: 1328 } }]
    await clickMap()

    expect(fetchEstablishment).toHaveBeenCalledWith(1328, expect.anything())
    // getBy rather than findBy: this file runs on fake timers, and Testing Library's async queries
    // poll on real ones. The `act` above has already flushed the fetch's microtasks.
    expect(screen.getByRole('heading', { name: 'RAISING CANES #888' })).toBeInTheDocument()
  })

  // 47 of the 238 points in the opening view carry more than one establishment. Opening the first
  // of them would be answering the click arbitrarily.
  it('offers a choice when a click lands on a stack, without fetching anything', async () => {
    render(<MapPage />)
    await showMap()

    clicked = [{ properties: { id: 1328 } }, { properties: { id: 901 } }]
    await clickMap()

    expect(screen.getByRole('heading', { name: '2 places at this address' })).toBeInTheDocument()
    expect(fetchEstablishment).not.toHaveBeenCalled()
  })

  it('puts the open establishment in the address bar', async () => {
    render(<MapPage />)
    await showMap()

    clicked = [{ properties: { id: 1328 } }]
    await clickMap()

    expect(window.location.search).toContain('id=1328')
  })

  it('opens straight onto an establishment named in the address bar', async () => {
    window.history.replaceState(null, '', '/?id=1328')

    render(<MapPage />)
    await showMap()

    expect(fetchEstablishment).toHaveBeenCalledWith(1328, expect.anything())
  })

  it('closes the panel when the click lands on empty map', async () => {
    render(<MapPage />)
    await showMap()

    clicked = [{ properties: { id: 1328 } }]
    await clickMap()
    expect(screen.getByRole('heading', { name: 'RAISING CANES #888' })).toBeInTheDocument()

    clicked = []
    await clickMap()

    expect(screen.queryByRole('heading', { name: 'RAISING CANES #888' })).not.toBeInTheDocument()
  })

  // Pins are pixels on a WebGL canvas: they take no focus and are in no accessibility tree. Without
  // the list, a keyboard user can reach every filter and never reach a restaurant.
  it('offers the establishments in view as text, reachable without a mouse', async () => {
    render(<MapPage />)
    await showMap()

    const list = screen.getByRole('region', { name: 'Places in view' })
    expect(within(list).getByRole('button', { name: /RAISING CANES/ })).toBeInTheDocument()
  })

  it('opens the record from the list, the same one a click opens', async () => {
    render(<MapPage />)
    await showMap()

    const list = screen.getByRole('region', { name: 'Places in view' })
    await act(async () => {
      fireEvent.click(within(list).getByRole('button', { name: /RAISING CANES/ }))
    })

    expect(fetchEstablishment).toHaveBeenCalledWith(1328, expect.anything())
  })

  // A link carrying ?id= names an establishment that is usually nowhere near the opening view, so
  // the record would open while the map showed a different part of the city.
  it('moves the map to an establishment that is not on screen', async () => {
    fetchEstablishment.mockResolvedValue({
      id: 21,
      name: 'POPEYES',
      cuisine: 'Chicken',
      phone: null,
      addressLine: '1351 FOREST AVENUE',
      locality: 'Staten Island',
      postalCode: '10302',
      latitude: 40.6259,
      longitude: -74.1344,
      isAwaitingFirstInspection: false,
      inspections: [],
    })
    window.history.replaceState(null, '', '/?id=21')

    render(<MapPage />)
    await showMap()

    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-74.1344, 40.6259] }))
  })

  // Clicking a pin you are already looking at must not yank the camera out from under you.
  it('leaves the camera alone for an establishment already in view', async () => {
    render(<MapPage />)
    await showMap()

    clicked = [{ properties: { id: 1328 } }]
    await clickMap()

    expect(easeTo).not.toHaveBeenCalled()
  })

  // Reported from a browser: after being taken to an establishment, dragging away snapped the map
  // straight back to it — once, and then it behaved.
  //
  // The cause was making the camera target a *derived* value: "is the chosen establishment off
  // screen?" is true again the moment you drag away from the place you were just taken to, so it
  // re-armed and fired. The second drag left the answer unchanged, so nothing re-ran, which is
  // exactly why it happened once. A camera move belongs to the act of choosing, so it happens once
  // per record and never again.
  it('does not drag the camera back after the user moves away from it', async () => {
    fetchEstablishment.mockResolvedValue({
      id: 21,
      name: 'POPEYES',
      cuisine: 'Chicken',
      phone: null,
      addressLine: '1351 FOREST AVENUE',
      locality: 'Staten Island',
      postalCode: '10302',
      latitude: 40.6259,
      longitude: -74.1344,
      isAwaitingFirstInspection: false,
      inspections: [],
    })
    window.history.replaceState(null, '', '/?id=21')

    render(<MapPage />)
    await showMap()
    expect(easeTo).toHaveBeenCalledTimes(1)

    // The map arrives: the establishment is now inside the viewport.
    bounds = { south: 40.62, north: 40.63, west: -74.14, east: -74.13 }
    await act(async () => {
      handlers.get('moveend')?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(debounceMilliseconds)
    })

    // The user drags away. The establishment is off screen again — which is precisely the condition
    // that used to re-fire the move.
    bounds = { south: 40.72, north: 40.73, west: -73.99, east: -73.98 }
    await act(async () => {
      handlers.get('moveend')?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(debounceMilliseconds)
    })

    expect(easeTo).toHaveBeenCalledTimes(1)
  })
})
