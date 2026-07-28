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
/**
 * One spy per source, because there are two now: the establishments and the selected establishment.
 * A single shared spy made `deliveredFeatures` read whichever source was written last, which is the
 * selection — so a test about pins started asserting against an empty selection.
 */
const setDataBySource = new Map<string, ReturnType<typeof vi.fn>>()

function setDataFor(sourceId: string) {
  const existing = setDataBySource.get(sourceId)

  if (existing !== undefined) {
    return existing
  }

  const spy = vi.fn()
  setDataBySource.set(sourceId, spy)

  return spy
}

const setData = setDataFor('establishments')
let sourceExists = false

/** Whether the fake map says the camera is in motion. The test decides. */
let moving = false

/** Where the fake map says the selected establishment lands, in container pixels. */
let projected = { x: 400, y: 300 }

/** A cut-down Positron: two symbol layers, one of which stops below the label threshold. */
const styleLayers = [
  { id: 'water', type: 'fill' },
  { id: 'road', type: 'line' },
  { id: 'place-label', type: 'symbol' },
  { id: 'country-label', type: 'symbol', maxzoom: 8 },
]

const setLayerZoomRange = vi.fn()
const setLayoutProperty = vi.fn()
const removeLayer = vi.fn()
const addedSources: unknown[][] = []
const addedLayers: unknown[][] = []

vi.mock('maplibre-gl', () => ({
  Map: class {
    addControl = vi.fn()
    remove = vi.fn()
    addSource = (...args: unknown[]) => {
      addedSources.push(args)
      if (args[0] === 'establishments') {
        sourceExists = true
      }
      addSource(...args)
    }
    addLayer = (...args: unknown[]) => {
      addedLayers.push(args)
      addLayer(...args)
    }
    removeLayer = removeLayer
    getSource = (id: string) =>
      id === 'establishments' && !sourceExists ? undefined : { setData: setDataFor(id) }
    isMoving = () => moving
    getStyle = () => ({ layers: styleLayers })
    setLayerZoomRange = setLayerZoomRange
    setLayoutProperty = setLayoutProperty
    // The off-screen indicator projects the selection into container pixels every frame.
    // A fixed 800x600 container and a projection the test controls, so the arithmetic is
    // assertable — see `projected`.
    getContainer = () => ({ clientWidth: 800, clientHeight: 600 })
    project = () => projected
    off = vi.fn()
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

function endMovement() {
  moving = false
  act(() => {
    handlers.get('moveend')?.()
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

  // By name, not by position. There are two sources now and the selection is added last, so
  // `at(-1)` read the wrong one — the same mistake this helper already made once when the hover
  // source existed.
  const fromSource = addSource.mock.calls.find((call) => call[0] === 'establishments')?.[1] as
    | { data: { features: unknown[] } }
    | undefined

  return fromSource?.data.features ?? []
}

beforeEach(() => {
  handlers.clear()
  addSource.mockClear()
  addLayer.mockClear()
  setDataBySource.forEach((spy) => spy.mockClear())
  sourceExists = false
  moving = false
  projected = { x: 400, y: 300 }
  setLayerZoomRange.mockClear()
  setLayoutProperty.mockClear()
  removeLayer.mockClear()
  addedSources.length = 0
  addedLayers.length = 0
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

  /**
   * Four layers over one source, in draw order: the two cluster layers first and largest, then the
   * individual pins that survive at this zoom on top of them. Within each pair, the ordinary ones
   * before the ones that must not be hidden — a layer draws its features in whatever order the
   * source hands them over, so "on top" is something only a second layer can promise.
   */
  it('adds cluster and pin layers over one source, clusters underneath', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)

    loadStyle()

    const ids = addedLayers
      .filter((call) => (call[0] as { source?: string }).source === 'establishments')
      .map((call) => (call[0] as { id: string }).id)

    expect(ids).toEqual([
      'establishments-cluster-ordinary',
      'establishments-cluster-priority',
      'establishments-ordinary',
      'establishments-priority',
    ])
  })

  /**
   * Clustering is MapLibre's, configured on the source. `clusterRadius` is a *screen* distance, so
   * what it covers on the ground changes with the camera for free — which is what makes consolidation
   * vary with zoom without a line of zoom-dependent code.
   */
  it('clusters on the source, by a pixel radius', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)

    loadStyle()

    const source = addedSources.find((call) => call[0] === 'establishments')?.[1] as {
      cluster?: boolean
      clusterRadius?: number
      clusterMaxZoom?: number
      clusterProperties?: Record<string, unknown>
    }

    expect(source.cluster).toBe(true)
    expect(source.clusterRadius).toBe(28)
    expect(source.clusterMaxZoom).toBe(16)

    // The worst state under a cluster, as a minimum — see pinSeverity.
    expect(source.clusterProperties?.severity).toEqual(['min', ['get', 'severity']])
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

  // Reported from a browser: panning stutters while a request for the current view is resolving.
  // The cost is not this client's — validating a thousand pins and turning them into GeoJSON is
  // about 2ms — it is MapLibre re-tiling the source, which shares a worker pool with parsing the
  // basemap tiles for wherever the user is panning into. So the expensive call waits for the
  // gesture to end rather than landing in the middle of it.
  it('does not touch the source while the map is moving', () => {
    const { rerender } = render(<MapView establishments={[pin]} initialViewport={viewport} />)
    loadStyle()
    setData.mockClear()

    moving = true
    rerender(<MapView establishments={[pin, { ...pin, id: 2 }]} initialViewport={viewport} />)

    expect(setData).not.toHaveBeenCalled()
  })

  it('applies the pins it held back as soon as the movement ends', () => {
    const { rerender } = render(<MapView establishments={[pin]} initialViewport={viewport} />)
    loadStyle()
    setData.mockClear()

    moving = true
    rerender(<MapView establishments={[pin, { ...pin, id: 2 }]} initialViewport={viewport} />)
    endMovement()

    expect(setData).toHaveBeenCalledTimes(1)
    expect((setData.mock.calls[0][0] as { features: unknown[] }).features).toHaveLength(2)
  })

  // Only the last one. Three viewports resolving during one long drag must not become three
  // re-tilings the instant the user lets go.
  it('applies only the newest pins when several arrived during one gesture', () => {
    const { rerender } = render(<MapView establishments={[pin]} initialViewport={viewport} />)
    loadStyle()
    setData.mockClear()

    moving = true
    rerender(<MapView establishments={[pin, { ...pin, id: 2 }]} initialViewport={viewport} />)
    rerender(
      <MapView
        establishments={[pin, { ...pin, id: 2 }, { ...pin, id: 3 }]}
        initialViewport={viewport}
      />,
    )
    endMovement()

    expect(setData).toHaveBeenCalledTimes(1)
    expect((setData.mock.calls[0][0] as { features: unknown[] }).features).toHaveLength(3)
  })

  it('does not re-apply anything on a movement that held nothing back', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)
    loadStyle()
    setData.mockClear()

    endMovement()

    expect(setData).not.toHaveBeenCalled()
  })

  // Reported from a browser: smooth at a viewport of 0.0376 by 0.0503 degrees, jittery any further
  // out. The pins are not the variable — that box and one three times larger both return exactly
  // 1,000 establishments, because both truncate. The basemap is: 27 of its 95 layers are symbol
  // layers, and MapLibre recomputes label placement on the main thread every time the map rotates.
  it('stops the basemap drawing labels when zoomed out', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)
    loadStyle()

    expect(setLayerZoomRange).toHaveBeenCalledWith('place-label', 14, 24)
  })

  it('leaves the layers that are not labels alone', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)
    loadStyle()

    const touched = setLayerZoomRange.mock.calls.map((call) => call[0])
    expect(touched).not.toContain('water')
    expect(touched).not.toContain('road')
  })

  // A zoom range whose floor is above its ceiling is invalid. These are the labels that only ever
  // appear where labels are being switched off, so they go entirely.
  it('hides a label layer that stops below the threshold rather than inverting its range', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)
    loadStyle()

    expect(setLayoutProperty).toHaveBeenCalledWith('country-label', 'visibility', 'none')
    expect(setLayerZoomRange.mock.calls.map((call) => call[0])).not.toContain('country-label')
  })

  // A vector tile must be parsed before it can be drawn; an image must not. Measured against CARTO
  // over Manhattan, a zoom-14 vector tile is 389KB against 26KB of raster, and their vector tiles
  // stop at 14 — which is exactly where the reported jitter stopped, because above it MapLibre
  // overzooms tiles it has already parsed.
  it('draws the basemap geometry from raster tiles', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)
    loadStyle()

    const raster = addedLayers.find((call) => (call[0] as { type?: string }).type === 'raster')
    expect(raster).toBeDefined()
    // Underneath the labels, so they draw over the picture rather than beneath it.
    expect(raster?.[1]).toBe('place-label')
  })

  it('removes the vector geometry it replaced', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)
    loadStyle()

    const removed = removeLayer.mock.calls.map((call) => call[0])
    expect(removed).toContain('water')
    expect(removed).toContain('road')
  })

  // The labels stay vector so they stay upright when the map is rotated. Baked into a picture they
  // would turn with it and never turn back, which is the reason this is a hybrid at all.
  it('keeps the label layers rather than flattening them into the picture', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)
    loadStyle()

    expect(removeLayer.mock.calls.map((call) => call[0])).not.toContain('place-label')
    expect(setLayerZoomRange).toHaveBeenCalledWith('place-label', 14, 24)
  })
})

/**
 * The selected establishment, and the arrow that points at it once it has been panned off screen.
 *
 * The angle is the part worth testing. It comes from `map.project`, which already accounts for
 * bearing and pitch — so rotating the map moves the arrow with no bearing arithmetic anywhere, and
 * what can go wrong is the sign of an axis rather than the trigonometry. Screen `y` grows downwards,
 * and "correcting" for that is exactly how an arrow ends up pointing at the mirror image of its
 * target.
 */
describe('the selected establishment', () => {
  const selection = { latitude: 40.757, longitude: -73.986, state: 'Poor' as const }

  function renderWithSelection() {
    const result = render(
      <MapView establishments={[pin]} initialViewport={viewport} selection={selection} />,
    )
    loadStyle()

    return result
  }

  it('draws it in a source of its own, above everything else', () => {
    renderWithSelection()

    const ids = addedLayers.map((call) => (call[0] as { id: string }).id)
    const sources = addedSources.map((call) => call[0])

    expect(sources).toContain('establishment-selection')

    // Last two, so nothing is drawn over the selection.
    expect(ids.slice(-2)).toEqual([
      'establishment-selection-halo',
      'establishment-selection-ring',
    ])
  })

  it('writes the selected point, with the colour of its state', () => {
    renderWithSelection()

    const written = setDataFor('establishment-selection').mock.calls.at(-1)?.[0] as {
      features: { geometry: { coordinates: number[] }; properties: { state: string } }[]
    }

    expect(written.features).toHaveLength(1)
    expect(written.features[0].geometry.coordinates).toEqual([-73.986, 40.757])
    expect(written.features[0].properties.state).toBe('Poor')
  })

  /** On screen, the dot is already the pointer and a second one would be noise. */
  it('hides the arrow while the selection is visible', () => {
    projected = { x: 400, y: 300 }

    const { container } = renderWithSelection()
    const arrow = container.querySelector('.map-offscreen') as HTMLElement

    expect(arrow.style.display).toBe('none')
  })

  /**
   * Off to the right: the arrow sits on the right edge pointing at 0°, which is what `atan2(0, +x)`
   * gives and what "east on screen" means.
   */
  it('points along the exact angle to an off-screen selection', () => {
    projected = { x: 2000, y: 300 }

    const { container } = renderWithSelection()
    const arrow = container.querySelector('.map-offscreen') as HTMLElement

    expect(arrow.style.display).toBe('flex')
    expect(arrow.style.transform).toContain('rotate(0deg)')
  })

  /**
   * Below and to the right, on the diagonal — 45°, and *positive*, because screen y grows downwards.
   * A sign flip here would send the arrow to the reflection of its target and pass any test that
   * only checked the arrow was visible.
   */
  it('uses screen coordinates, so down-right is a positive angle', () => {
    projected = { x: 400 + 1000, y: 300 + 1000 }

    const { container } = renderWithSelection()
    const arrow = container.querySelector('.map-offscreen') as HTMLElement

    expect(arrow.style.transform).toContain('rotate(45deg)')
  })

  /** Straight up is −90°, not 90°. The other half of the same trap. */
  it('points upwards for a selection above the view', () => {
    projected = { x: 400, y: -500 }

    const { container } = renderWithSelection()
    const arrow = container.querySelector('.map-offscreen') as HTMLElement

    expect(arrow.style.transform).toContain('rotate(-90deg)')
  })

  /**
   * An indicator that only points is a thing to look at. This one is the only control on screen that
   * knows where the selection went, so pressing it goes there.
   */
  it('takes you back to the selection when the arrow is pressed', () => {
    projected = { x: 2000, y: 300 }
    const onRecentre = vi.fn()

    const { container } = render(
      <MapView
        establishments={[pin]}
        initialViewport={viewport}
        selection={selection}
        onRecentre={onRecentre}
      />,
    )
    loadStyle()

    const arrow = container.querySelector('.map-offscreen') as HTMLButtonElement
    arrow.click()

    expect(onRecentre).toHaveBeenCalled()
  })

  /** A control needs a name; the rotation is a visual affordance and is hidden from a reader. */
  it('names the arrow for assistive technology while hiding the rotation', () => {
    projected = { x: 2000, y: 300 }

    const { container, getByRole } = render(
      <MapView establishments={[pin]} initialViewport={viewport} selection={selection} />,
    )
    loadStyle()

    expect(getByRole('button', { name: /return to the selected establishment/i })).toBeInTheDocument()
    expect(container.querySelector('.map-offscreen svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows no arrow when nothing is selected', () => {
    projected = { x: 2000, y: 300 }

    const { container } = render(
      <MapView establishments={[pin]} initialViewport={viewport} selection={null} />,
    )
    loadStyle()

    const arrow = container.querySelector('.map-offscreen') as HTMLElement
    expect(arrow.style.display).toBe('none')
  })
})
