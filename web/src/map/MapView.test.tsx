import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapEstablishment } from '../api/contract'
import type { Viewport } from '../api/viewport'
import { MapView } from './MapView'
import { pinStates } from './pinStyle'

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
const addImage = vi.fn()
const setData = vi.fn()
let sourceExists = false

/** Whether the fake map says the camera is in motion. The test decides. */
let moving = false

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
    // The sphere sprites. hasImage answers false so registration runs; the pixels themselves are
    // asserted in sphereSprite.test.ts, where they can actually be read.
    hasImage = () => false
    addImage = addImage
    addLayer = (...args: unknown[]) => {
      addedLayers.push(args)
      addLayer(...args)
    }
    removeLayer = removeLayer
    getSource = () => (sourceExists ? { setData } : undefined)
    isMoving = () => moving
    getStyle = () => ({ layers: styleLayers })
    setLayerZoomRange = setLayerZoomRange
    setLayoutProperty = setLayoutProperty
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

  // By name rather than by position: there is a second, separate source holding the hovered point,
  // and it is added after this one.
  const fromSource = addSource.mock.calls.findLast((call) => call[0] === 'establishments')?.[1] as
    | { data: { features: unknown[] } }
    | undefined

  return fromSource?.data.features ?? []
}

beforeEach(() => {
  handlers.clear()
  addSource.mockClear()
  addLayer.mockClear()
  addImage.mockClear()
  setData.mockClear()
  sourceExists = false
  moving = false
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
   * Two layers over one source, split so the rare states are not painted over by their neighbours.
   *
   * There is no separate shadow layer any more: an offset blurred copy read as a sticker rather than
   * as an object, and the spheres carry their own shading in the sprite. Two layers rather than
   * three is the cheaper arrangement as well as the better-looking one.
   */
  it('adds two pin layers over one source', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)

    loadStyle()

    const pinLayers = addedLayers.filter(
      (call) => (call[0] as { source?: string }).source === 'establishments',
    )
    expect(pinLayers).toHaveLength(2)
  })

  /**
   * Symbols, not circles — a circle layer has no gradient or lighting, so a sphere has to be an
   * image. Collision detection is off on both counts: a symbol layer's default is to *hide* icons
   * that overlap, and a dense block of restaurants is the honest picture rather than a placement
   * problem.
   */
  it('draws the pins as sprites that are never hidden by their neighbours', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)

    loadStyle()

    const [firstPinLayer] = addedLayers
      .map((call) => call[0] as { source?: string; type?: string; layout?: Record<string, unknown> })
      .filter((layer) => layer.source === 'establishments')

    expect(firstPinLayer.type).toBe('symbol')
    expect(firstPinLayer.layout?.['icon-allow-overlap']).toBe(true)
    expect(firstPinLayer.layout?.['icon-ignore-placement']).toBe(true)
  })

  /**
   * Two spheres per state, registered before any layer asks for one by name: the ordinary one and
   * the closed variant, whose silhouette darkens towards the closure colour. Closure is a separate
   * fact from the result, and baking the rim into a sprite is the only way it survives the move from
   * a stroked circle.
   */
  it('registers an ordinary and a closed sphere for every pin state', () => {
    render(<MapView establishments={[pin]} initialViewport={viewport} />)

    loadStyle()

    expect(addImage).toHaveBeenCalledTimes(pinStates.length * 2)

    const names = addImage.mock.calls.map((call) => call[0] as string)
    expect(names).toContain('sphere-Poor')
    expect(names).toContain('sphere-Poor-closed')
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
    // A different coordinate, not just a different id: features are one per point now, so two pins
    // at the same place would arrive as one feature and this would be counting the wrong thing.
    rerender(
      <MapView
        establishments={[pin, { ...pin, id: 2, latitude: pin.latitude + 0.001 }]}
        initialViewport={viewport}
      />,
    )
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
    // Distinct coordinates throughout, for the reason above: one feature per point means pins that
    // share a place arrive as one feature, and the count would stop meaning what it says.
    const second = { ...pin, id: 2, latitude: pin.latitude + 0.001 }
    const third = { ...pin, id: 3, latitude: pin.latitude + 0.002 }

    rerender(<MapView establishments={[pin, second]} initialViewport={viewport} />)
    rerender(<MapView establishments={[pin, second, third]} initialViewport={viewport} />)
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
