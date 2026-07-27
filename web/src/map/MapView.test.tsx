import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapEstablishment } from '../api/contract'
import type { Viewport } from '../api/viewport'
import { MapView } from './MapView'

/**
 * These tests exist because of a bug that shipped past a green suite.
 *
 * The map is constructed once, so its event handlers close over the props of the first render — and
 * on the first render there are no pins yet, because the request has not returned. Whether that
 * matters depends entirely on which happens first: the style loading, or the data arriving. The
 * original test double fired `style.load` synchronously inside `render`, which is the ordering that
 * *cannot* occur in a browser — the style is a network fetch of several hundred kilobytes and the
 * API answers in tens of milliseconds. The data always wins, the source was always created empty,
 * and the map was always blank.
 *
 * So this double never fires anything by itself. The test decides when the style loads, and both
 * orderings are asserted.
 */
const handlers = new Map<string, () => void>()
const addSource = vi.fn()
const addLayer = vi.fn()
const setData = vi.fn()
let sourceExists = false

vi.mock('maplibre-gl', () => ({
  Map: class {
    addControl = vi.fn()
    remove = vi.fn()
    addSource = (...args: unknown[]) => {
      sourceExists = true
      addSource(...args)
    }
    addLayer = addLayer
    getSource = () => (sourceExists ? { setData } : undefined)
    on(event: string, handler: () => void) {
      handlers.set(event, handler)
    }
  },
  LngLatBounds: class {},
  NavigationControl: class {},
}))

function loadStyle() {
  act(() => {
    handlers.get('style.load')?.()
  })
}

const viewport: Viewport = {
  minLatitude: 40.752,
  maxLatitude: 40.76,
  minLongitude: -73.9908,
  maxLongitude: -73.9802,
}

const pin: MapEstablishment = {
  id: 1328,
  name: 'RAISING CANES #888',
  latitude: 40.7570962405,
  longitude: -73.986193424352,
  isAwaitingFirstInspection: false,
  latestInspection: {
    inspectedOn: '2025-11-20',
    rawGrade: 'A',
    outcome: 'Good',
    normalisedSeverity: 9,
    closedByAuthority: false,
  },
}

/** The features the map was actually given, whichever call delivered them. */
function deliveredFeatures(): unknown[] {
  const fromSetData = setData.mock.calls.at(-1)?.[0] as { features: unknown[] } | undefined

  if (fromSetData !== undefined) {
    return fromSetData.features
  }

  const fromSource = addSource.mock.calls.at(-1)?.[1] as
    | { data: { features: unknown[] } }
    | undefined

  return fromSource?.data.features ?? []
}

beforeEach(() => {
  handlers.clear()
  addSource.mockClear()
  addLayer.mockClear()
  setData.mockClear()
  sourceExists = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MapView', () => {
  // The ordering that actually happens in a browser, and the one that was broken: the pins arrive
  // while the style is still downloading, so there is no source to put them in yet — and the source
  // must be created from the pins that exist by then, not from the empty array the map was mounted
  // with.
  it('draws pins that arrived before the style finished loading', () => {
    const { rerender } = render(<MapView establishments={[]} initialViewport={viewport} />)

    rerender(<MapView establishments={[pin]} initialViewport={viewport} />)
    expect(addSource).not.toHaveBeenCalled()

    loadStyle()

    expect(deliveredFeatures()).toHaveLength(1)
  })

  it('draws pins that arrive after the style has loaded', () => {
    const { rerender } = render(<MapView establishments={[]} initialViewport={viewport} />)

    loadStyle()
    rerender(<MapView establishments={[pin]} initialViewport={viewport} />)

    expect(deliveredFeatures()).toHaveLength(1)
  })

  it('adds two layers over one source, so the rare pins are not painted over', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)

    loadStyle()

    expect(addSource).toHaveBeenCalledTimes(1)
    expect(addLayer).toHaveBeenCalledTimes(2)
  })

  it('says so when the map itself fails, rather than leaving a blank rectangle', () => {
    const { getByRole } = render(<MapView establishments={[pin]} initialViewport={viewport} />)

    act(() => {
      ;(handlers.get('error') as unknown as (event: { error: Error }) => void)?.({
        error: new Error('WebGL is not supported'),
      })
    })

    expect(getByRole('alert')).toHaveTextContent('WebGL is not supported')
  })
})
