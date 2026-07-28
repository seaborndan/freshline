/**
 * The MapLibre canvas.
 *
 * The only component that touches the map library, and it is written as a thin, imperative shell on
 * purpose: MapLibre owns a WebGL canvas and its own object graph, React owns a DOM tree, and the
 * cheapest way for the two to coexist is one effect that creates the map and one that pushes data
 * into it. Everything decidable — colours, sizes, coordinate order, which pins are on top — lives in
 * the plain modules beside this file, where it can be tested without a GPU.
 */

import { useEffect, useRef, useState } from 'react'
import { LngLatBounds, Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapEstablishment } from '../api/contract'
import type { Viewport } from '../api/viewport'
import { toFeatureCollection } from './geoJson'
import {
  circleColour,
  circleRadius,
  circleStrokeColour,
  circleStrokeWidth,
  ordinaryFilter,
  priorityFilter,
} from './layers'
import {
  basemapAttribution,
  basemapRasterTiles,
  basemapStyleUrl,
  dataBounds,
  labelMinimumZoom,
  minimumZoom,
} from './initialView'
import { viewportOf } from './viewportOf'

const rasterSourceId = 'basemap-geometry'
const rasterLayerId = 'basemap-geometry'

/**
 * Replaces the basemap's geometry with pictures, keeping its lettering.
 *
 * Positron arrives as 95 layers: a background, 9 fills, 56 lines, 2 circles and 27 symbol layers.
 * Everything but the background and the symbols is removed and a single raster layer put in its
 * place, underneath the labels. See `basemapRasterTiles` for the measurements behind this — the
 * short version is that a vector tile has to be parsed before it can be drawn and an image does not,
 * and parsing is what makes the map stutter when it moves somewhere new.
 *
 * The labels stay vector so they stay upright when the map is rotated. Baked into a picture they
 * would turn with it and never turn back.
 */
function drawGeometryFromRasterTiles(map: MapLibreMap): void {
  const layers = map.getStyle().layers
  const firstSymbolLayer = layers.find((layer) => layer.type === 'symbol')?.id

  map.addSource(rasterSourceId, {
    type: 'raster',
    tiles: [basemapRasterTiles],
    // 256 with an @2x URL: the images are 512 pixels drawn into 256 of layout, which is how a raster
    // basemap stays sharp on a high-density display.
    tileSize: 256,
    attribution: basemapAttribution,
  })

  // Beneath the labels, above the background.
  map.addLayer({ id: rasterLayerId, type: 'raster', source: rasterSourceId }, firstSymbolLayer)

  for (const layer of layers) {
    if (layer.type === 'fill' || layer.type === 'line' || layer.type === 'circle') {
      map.removeLayer(layer.id)
    }
  }
}

/**
 * Stops the basemap drawing labels below `labelMinimumZoom`.
 *
 * Done declaratively, by narrowing each symbol layer's own zoom range, so MapLibre applies it as the
 * camera moves and nothing has to run per frame or per gesture. The alternative — toggling layer
 * visibility on `movestart` and `moveend` — would keep labels at every zoom but pay a re-layout of
 * 27 layers twice per gesture, which is the cost this is trying to avoid, moved rather than removed.
 */
function quietenLabelsWhenZoomedOut(map: MapLibreMap): void {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol') {
      continue
    }

    const maxzoom = layer.maxzoom ?? 24

    // Some label layers exist only at low zoom and stop before this threshold begins. A zoom range
    // whose floor is above its ceiling is invalid, so those are hidden outright — they are the
    // labels that only ever appear where labels are being turned off.
    if (labelMinimumZoom >= maxzoom) {
      map.setLayoutProperty(layer.id, 'visibility', 'none')
      continue
    }

    map.setLayerZoomRange(layer.id, Math.max(layer.minzoom ?? 0, labelMinimumZoom), maxzoom)
  }
}

const sourceId = 'establishments'
const ordinaryLayerId = 'establishments-ordinary'
const priorityLayerId = 'establishments-priority'

export interface MapViewProps {
  /** The pins to draw. */
  establishments: readonly MapEstablishment[]

  /** The box the map opens on. Read once, at construction. */
  initialViewport: Viewport

  /**
   * Called with the box the map is showing, whenever it settles.
   *
   * The map is the authority on what is on screen — it knows the window size, the zoom and the
   * projection, and nothing above it does. It reports; deciding what to do about it, and how often,
   * belongs to `useEstablishments`.
   */
  onViewportChange?: (viewport: Viewport) => void

  /**
   * Called with the ids of every establishment under a click, in draw order — several when the
   * click landed on a stacked point, none when it landed on empty map.
   *
   * Ids rather than establishments, because this component is handed pins to draw and should not
   * also become the place that decides what a click *means*.
   */
  onSelect?: (ids: number[]) => void

  /**
   * A point the map should move to, or null to leave the camera alone.
   *
   * Exists for one case: a link carrying `?id=` names an establishment that is usually nowhere near
   * the opening view, so the record would open while the map showed a different part of the city.
   * The caller decides when that is worth a camera move; this only carries it out.
   */
  focusOn?: { latitude: number; longitude: number } | null

  /**
   * A box the map should frame, or null to leave the camera alone.
   *
   * Exists for filtering to a borough: choosing "Staten Island" while looking at Times Square
   * otherwise empties the map, because the filter is applied to a viewport that contains none of it.
   * The user's request was to see that borough, and the honest reading of it moves the camera.
   *
   * A box rather than a centre and a zoom, for the same reason the URL carries one: `fitBounds`
   * guarantees the whole area is visible on any window size, where a zoom would frame a different
   * amount of city on a phone than on a monitor.
   */
  frameBounds?: Viewport | null
}

export function MapView({
  establishments,
  initialViewport,
  onViewportChange,
  onSelect,
  focusOn,
  frameBounds,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)

  /**
   * Two ways the canvas can stay empty while everything else on the page works: the browser cannot
   * give MapLibre a WebGL context, or the basemap style fails to load. Both are silent — the div is
   * simply blank — and both are worth saying out loud, because a blank rectangle is
   * indistinguishable from "there are no restaurants here".
   */
  const [mapFailure, setMapFailure] = useState<string | null>(null)

  /**
   * The pins as of the latest render, readable from inside a callback that outlives it.
   *
   * The map is constructed once, so everything registered on it closes over the props of the *first*
   * render — where this array is still empty, because the request has not come back. Reading
   * `establishments` directly inside the `style.load` handler therefore adds an empty source, and
   * whether that matters is a race: the style takes seconds to fetch over the network while the API
   * answers in tens of milliseconds, so in practice the data always loses and the map is always
   * empty. It was a test that fired `style.load` synchronously — the ordering that cannot happen in
   * a browser — which made this look fine.
   */
  const latestEstablishments = useRef(establishments)
  latestEstablishments.current = establishments

  // The same reasoning as the pins above, for the same reason: a handler registered once must not
  // hold the first render's copy of a prop.
  const latestOnViewportChange = useRef(onViewportChange)
  latestOnViewportChange.current = onViewportChange

  const latestOnSelect = useRef(onSelect)
  latestOnSelect.current = onSelect

  /**
   * Pins that arrived while the user was still moving the map, held until they stop.
   *
   * **Why this exists.** `setData` is the most expensive thing this component does, and almost none
   * of that cost is JavaScript — the whole client-side pipeline, validating a thousand pins and
   * turning them into GeoJSON, measures about 2ms. What costs is what MapLibre does next: the source
   * is re-tiled, and that work shares a worker pool with parsing the basemap tiles for wherever the
   * user is panning *into*. Doing it in the middle of a drag makes the drag stutter, which is a much
   * worse thing to be than a second late with the dots.
   *
   * So new data waits for the gesture to finish. The pins are then always at most one `moveend`
   * behind, and the map never does bookkeeping while somebody is holding it.
   */
  const pendingData = useRef<ReturnType<typeof toFeatureCollection> | null>(null)

  function setOrDefer(target: MapLibreMap, data: ReturnType<typeof toFeatureCollection>) {
    const source = target.getSource(sourceId) as GeoJSONSource | undefined

    if (source === undefined) {
      return
    }

    // `isMoving` covers panning, zooming, rotating and the inertial glide after a flick — every way
    // the camera can be in motion, including ones no single event name would catch.
    if (target.isMoving()) {
      pendingData.current = data
      return
    }

    source.setData(data)
  }

  function flushPendingData(target: MapLibreMap) {
    const data = pendingData.current

    if (data === null) {
      return
    }

    pendingData.current = null
    ;(target.getSource(sourceId) as GeoJSONSource | undefined)?.setData(data)
  }

  // Created once and never recreated: the effect has no dependencies, so a change of pins re-runs
  // the second effect rather than tearing down a WebGL context and rebuilding the basemap.
  useEffect(() => {
    if (container.current === null) {
      return
    }

    const created = new MapLibreMap({
      container: container.current,
      style: basemapStyleUrl,

      // fitBounds rather than a centre and a zoom, so that what is drawn is exactly the box that was
      // fetched, on any window size. Centre and zoom would frame a different amount of city on a
      // phone than on a monitor, and pins outside the fetched box simply do not exist yet.
      bounds: new LngLatBounds(
        [initialViewport.minLongitude, initialViewport.minLatitude],
        [initialViewport.maxLongitude, initialViewport.maxLatitude],
      ),
      fitBoundsOptions: { padding: 24 },

      // The camera cannot leave the city, and cannot zoom out past it. This product has data about
      // one city; letting someone drift to the Atlantic shows them an empty map that reads as
      // broken rather than as out of scope. It also stops the basemap fetching and parsing tiles for
      // places nothing here will ever describe, on the same worker that draws the pins.
      maxBounds: new LngLatBounds(
        [dataBounds.minLongitude, dataBounds.minLatitude],
        [dataBounds.maxLongitude, dataBounds.maxLatitude],
      ),
      minZoom: minimumZoom,

      // Labels fade in and out by default, and a fade is an animation: the map keeps re-rendering
      // after the camera has stopped, and keeps re-running symbol placement while it does. Popping
      // is the cheaper honesty here.
      fadeDuration: 0,

      // One world, not three. With the camera locked to New York the repeated copies either side
      // can never be looked at, and not drawing them is free.
      renderWorldCopies: false,

      // Hold on to parsed tiles far longer than the default, which keeps roughly what fits on
      // screen. Rotating in place is the case this is for: turning the map sweeps tiles through the
      // corners of the viewport, out again, and back, and each eviction means parsing the same
      // hundreds of kilobytes of geometry a second time. Measured from CARTO: a zoom-14 tile over
      // Manhattan is 389KB, zoom 12 is 98KB.
      //
      // The cost is memory, and it is not free — a few hundred parsed tiles is tens of megabytes.
      // Bounded deliberately rather than left to grow.
      maxTileCacheSize: 150,

      // Keep tiles from more zoom levels than the default of five, so zooming out and back in
      // re-uses what was already parsed instead of re-fetching each level on the way.
      maxTileCacheZoomLevels: 8,

      // The basemap of a city does not change while somebody is looking at it. Re-requesting tiles
      // because a cache header expired mid-session buys nothing here and costs a parse.
      refreshExpiredTiles: false,

      // The map is one input among several, not the whole page. Scroll-zoom that captures the wheel
      // as soon as the pointer crosses the canvas makes the page impossible to scroll past on a
      // laptop; the modifier key is the standard escape and MapLibre writes the instruction itself.
      cooperativeGestures: true,
    })

    created.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    // MapLibre reports a missing WebGL context and a failed style fetch through the same event, and
    // reports nothing at all to the user. Without this the page looks loaded and shows no map.
    created.on('error', (event: { error?: Error }) => {
      setMapFailure(event.error?.message ?? 'The map could not be drawn.')
    })

    // Queried rather than registered per layer, so the two pin layers are asked as one and the
    // answer keeps its draw order. A click on empty map returns nothing, which is a deselection.
    //
    // Every feature under the cursor comes back, not just the top one. That matters here: 47 of the
    // 238 points in the opening view carry more than one establishment and the busiest carries 18,
    // so answering with the first would be answering arbitrarily.
    created.on('click', (event) => {
      const features = created.queryRenderedFeatures(event.point, {
        layers: [ordinaryLayerId, priorityLayerId],
      })

      const ids = features
        .map((feature) => feature.properties?.id)
        .filter((id): id is number => typeof id === 'number')

      latestOnSelect.current?.([...new Set(ids)])
    })

    // A dot that can be clicked should say so before it is clicked.
    for (const layerId of [ordinaryLayerId, priorityLayerId]) {
      created.on('mouseenter', layerId, () => {
        created.getCanvas().style.cursor = 'pointer'
      })
      created.on('mouseleave', layerId, () => {
        created.getCanvas().style.cursor = ''
      })
    }

    // `moveend`, not `move`. A drag fires `move` continuously — one event per frame — and every one
    // of them would start the debounce timer again; `moveend` fires once when the camera settles,
    // including at the end of MapLibre's inertial glide. The debounce downstream is for the case
    // this does not cover: several discrete gestures in quick succession, like wheel-zoom steps.
    created.on('moveend', () => {
      // Anything that arrived mid-gesture has been waiting for exactly this moment.
      flushPendingData(created)

      latestOnViewportChange.current?.(viewportOf(created))
    })

    // `style.load`, not `load`. They sound interchangeable and are not: `load` waits for "the first
    // visually complete rendering of the map", so it depends on a frame actually being painted, while
    // `style.load` fires once the style is ready — which is the real precondition for adding a source
    // and a layer. Anywhere rendering stalls or is slow to start, `load` never arrives and the pins
    // are never added to a map that is otherwise working. Observed here: in headless Chromium the
    // style loads, the sources load, and `load` never fires.
    created.on('style.load', () => {
      // The opening box is set by the constructor rather than by an animation, so no `moveend` ever
      // announces it. Without this the map would sit on its initial viewport having told nobody what
      // it was, and the first request would be the one the user's first pan triggered.
      latestOnViewportChange.current?.(viewportOf(created))

      drawGeometryFromRasterTiles(created)

      // Applied after the geometry swap, so the only vector layers left are the ones this restricts.
      // That is what stops the vector tiles being fetched at all below this zoom: MapLibre asks a
      // source for tiles only when a visible layer needs them.
      quietenLabelsWhenZoomedOut(created)

      created.addSource(sourceId, {
        type: 'geojson',
        data: toFeatureCollection(latestEstablishments.current),
      })

      // Two layers over one source. The ordinary pins first, then the ones that must not be hidden
      // by them — see `priorityFilter`.
      for (const [id, filter] of [
        [ordinaryLayerId, ordinaryFilter],
        [priorityLayerId, priorityFilter],
      ] as const) {
        created.addLayer({
          id,
          type: 'circle',
          source: sourceId,
          filter,
          paint: {
            'circle-color': circleColour,
            'circle-radius': circleRadius,
            'circle-stroke-color': circleStrokeColour,
            'circle-stroke-width': circleStrokeWidth,
          },
        } as Parameters<typeof created.addLayer>[0])
      }
    })

    map.current = created

    return () => {
      created.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- constructed once; see above.
  }, [])

  // Moves the camera when the caller asks, and only then. Keyed on the coordinates rather than on
  // an object identity so that re-rendering with the same point does not re-fly to it.
  const focusLatitude = focusOn?.latitude ?? null
  const focusLongitude = focusOn?.longitude ?? null

  useEffect(() => {
    if (focusLatitude === null || focusLongitude === null || map.current === null) {
      return
    }

    map.current.easeTo({
      center: [focusLongitude, focusLatitude],
      // Close enough to see which building it is, and inside the zoom band where the basemap has
      // labels — the point of moving here is to show somebody where a place is.
      zoom: Math.max(map.current.getZoom(), 16),
      duration: 600,
    })
  }, [focusLatitude, focusLongitude])

  // Frames a box when the caller asks. Keyed on the four edges rather than on object identity, so a
  // re-render carrying an equal box does not re-fly to it — the same reasoning as `focusOn` above.
  const frameSouth = frameBounds?.minLatitude ?? null
  const frameNorth = frameBounds?.maxLatitude ?? null
  const frameWest = frameBounds?.minLongitude ?? null
  const frameEast = frameBounds?.maxLongitude ?? null

  useEffect(() => {
    if (
      frameSouth === null ||
      frameNorth === null ||
      frameWest === null ||
      frameEast === null ||
      map.current === null
    ) {
      return
    }

    map.current.fitBounds(
      new LngLatBounds([frameWest, frameSouth], [frameEast, frameNorth]),
      {
        // Room for the legend and the panels, which sit over the map rather than beside it. Without
        // it a borough's southern edge lands underneath the legend and reads as missing pins.
        padding: 48,
        duration: 700,
      },
    )
  }, [frameSouth, frameNorth, frameWest, frameEast])

  // Pushes new pins into the existing source, unless the user is mid-gesture — see `setOrDefer`.
  // Guarded because the pins usually arrive *before* the style has loaded, in which case there is no
  // source to push them into yet, and the `style.load` handler picks them up from the ref instead.
  // Those two paths together make the ordering safe in both directions; neither is sufficient alone.
  useEffect(() => {
    if (map.current === null) {
      return
    }

    setOrDefer(map.current, toFeatureCollection(establishments))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setOrDefer reads only refs.
  }, [establishments])

  return (
    <>
      {/* No role or label on this div: MapLibre puts `role="region"` and an accessible name on the
          canvas it creates inside, and nesting a second labelled region around it announces the map
          twice. Keyboard reach into the pins themselves is slice 6's problem, and the answer there
          is the list rather than the canvas. */}
      <div ref={container} className="map-canvas" />

      {mapFailure === null ? null : (
        <p role="alert" className="map-failure">
          The map could not be drawn: {mapFailure}
        </p>
      )}
    </>
  )
}
