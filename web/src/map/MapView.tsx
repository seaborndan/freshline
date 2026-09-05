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
import { toFeatureCollection, type PinFeature } from './geoJson'
import type { PinState } from './pinStyle'
import {
  circleColour,
  selectionColour,
  selectionHaloRadius,
  selectionRingRadius,
  circleRadius,
  circleStrokeColour,
  circleStrokeWidth,
  clusterCircleRadius,
  clusterColour,
  clusterMaxZoom,
  clusterOrdinaryFilter,
  clusterPriorityFilter,
  clusterRadius,
  clusterStrokeColour,
  ordinaryFilter,
  priorityFilter,
  unclusteredFilter,
} from './layers'
import {
  basemapStyleUrl,
  dataBounds,
  labelMinimumZoom,
  minimumZoom,
} from './initialView'
import { viewportOf } from './viewportOf'
import { basemapRequest } from './basemapRequest'

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
const clusterOrdinaryLayerId = 'establishments-cluster-ordinary'
const clusterPriorityLayerId = 'establishments-cluster-priority'

const selectionSourceId = 'establishment-selection'
const selectionHaloLayerId = 'establishment-selection-halo'
const selectionRingLayerId = 'establishment-selection-ring'

const noSelection = { type: 'FeatureCollection' as const, features: [] as PinFeature[] }

/** Every layer a click should consider. */
const clickableLayerIds = [
  clusterOrdinaryLayerId,
  clusterPriorityLayerId,
  ordinaryLayerId,
  priorityLayerId,
]

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
   * Exists for two cases: a link carrying `?id=` names an establishment that is usually nowhere near
   * the opening view, and the panel's own "Centre on map" button. The caller decides when a move is
   * warranted; this only carries it out.
   *
   * **`token` is what makes the second case work.** The effect below cannot key on the coordinates
   * alone — pressing the button, panning away, and pressing it again asks to go to the *same* place,
   * and an effect watching only latitude and longitude would not run the second time. The token
   * changes per request, so a repeated ask is a new ask.
   */
  focusOn?: { latitude: number; longitude: number; token: number } | null

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

  /**
   * The establishment currently open, or null.
   *
   * Drawn as its own source on top of everything — see `selectionHaloRadius` for why a separate
   * source rather than a style on the existing one — and used to aim the off-screen indicator.
   */
  selection?: { latitude: number; longitude: number; state: PinState } | null

  /**
   * Called when the off-screen indicator is activated.
   *
   * The arrow says where the selection is; pressing it should take you there, because an indicator
   * that only points is a thing to look at rather than a thing to use.
   */
  onRecentre?: () => void
}

export function MapView({
  establishments,
  initialViewport,
  onViewportChange,
  onSelect,
  focusOn,
  frameBounds,
  selection,
  onRecentre,
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
      transformRequest: basemapRequest,

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
      const features = created.queryRenderedFeatures(event.point, { layers: clickableLayerIds })

      // A lone pin carries its establishment's id directly.
      const direct = features
        .map((feature) => feature.properties?.id)
        .filter((id): id is number => typeof id === 'number')

      /*
       * A cluster carries a count, not the things it counted, so what is under it has to be asked
       * for — `getClusterLeaves` is the source's own answer and is callback-based, hence the
       * promises.
       *
       * The limit is deliberately generous. A cluster that reported only some of its establishments
       * would produce a chooser quietly missing rows, which is the failure this map has already been
       * caught making once with stacked pins: an answer that looks complete and is not.
       */
      const clusters = features.filter(
        (feature) => typeof feature.properties?.cluster_id === 'number',
      )

      if (clusters.length === 0) {
        latestOnSelect.current?.([...new Set(direct)])
        return
      }

      const source = created.getSource(sourceId) as GeoJSONSource | undefined

      if (source === undefined) {
        return
      }

      Promise.all(
        clusters.map((feature) =>
          source
            .getClusterLeaves(feature.properties.cluster_id as number, Number.MAX_SAFE_INTEGER, 0)
            .then((leaves) =>
              leaves
                .map((leaf) => leaf.properties?.id)
                .filter((id): id is number => typeof id === 'number'),
            ),
        ),
      )
        .then((fromClusters) => {
          latestOnSelect.current?.([...new Set([...direct, ...fromClusters.flat()])])
        })
        .catch(() => {
          // The cluster could not be opened. Falling back to whatever was clicked directly is
          // better than an unresponsive dot, and worse than the real answer — which is why it is a
          // fallback rather than the path.
          latestOnSelect.current?.([...new Set(direct)])
        })
    })

    // A dot that can be clicked should say so before it is clicked.
    for (const layerId of clickableLayerIds) {
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


      // Reduce label placement work when zoomed out; geometry remains vector at every zoom.
      quietenLabelsWhenZoomedOut(created)

      created.addSource(sourceId, {
        type: 'geojson',
        data: toFeatureCollection(latestEstablishments.current),

        /*
         * Clustering, and the reason it is MapLibre's rather than something written here.
         *
         * `clusterRadius` is a screen distance, so what it means on the ground changes with the
         * camera automatically — zooming in separates dots, zooming out merges them, with no
         * zoom-dependent code and nothing recomputed per frame. Supercluster builds one index per
         * zoom level when the data arrives and answers from it afterwards.
         *
         * `severity` accumulates as a minimum, which makes a cluster take the colour of the worst
         * thing under it. See `pinSeverity`: `Poor` is zero, so a cluster containing a failed
         * inspection is red however much good news is stacked with it.
         */
        cluster: true,
        clusterRadius,
        clusterMaxZoom,
        clusterProperties: { severity: ['min', ['get', 'severity']] },
      })

      /*
       * Four layers over one source, added in the order they must draw.
       *
       * Clusters first and largest, so the individual pins that survive at this zoom sit on top of
       * them rather than under. Within each of clusters and pins, the ordinary ones come before the
       * ones that must not be hidden — a layer draws its features in whatever order the source hands
       * them over, so "on top" is something only a second layer can promise.
       */
      for (const [id, filter, paint] of [
        [
          clusterOrdinaryLayerId,
          clusterOrdinaryFilter,
          {
            'circle-color': clusterColour,
            'circle-radius': clusterCircleRadius,
            'circle-stroke-color': clusterStrokeColour,
            'circle-stroke-width': 1.5,
          },
        ],
        [
          clusterPriorityLayerId,
          clusterPriorityFilter,
          {
            'circle-color': clusterColour,
            'circle-radius': clusterCircleRadius,
            'circle-stroke-color': clusterStrokeColour,
            'circle-stroke-width': 1.5,
          },
        ],
        [
          ordinaryLayerId,
          ['all', unclusteredFilter, ordinaryFilter],
          {
            'circle-color': circleColour,
            'circle-radius': circleRadius,
            'circle-stroke-color': circleStrokeColour,
            'circle-stroke-width': circleStrokeWidth,
          },
        ],
        [
          priorityLayerId,
          ['all', unclusteredFilter, priorityFilter],
          {
            'circle-color': circleColour,
            'circle-radius': circleRadius,
            'circle-stroke-color': circleStrokeColour,
            'circle-stroke-width': circleStrokeWidth,
          },
        ],
      ] as const) {
        created.addLayer({
          id,
          type: 'circle',
          source: sourceId,
          filter,
          paint,
        } as Parameters<typeof created.addLayer>[0])
      }

      created.addSource(selectionSourceId, { type: 'geojson', data: noSelection })

      /*
       * Two layers for one dot: a wide, soft halo and a hard white-ringed core over it.
       *
       * One circle cannot do both jobs. A big flat disc hides its neighbours, and a small ringed one
       * does not read as *selected* at a glance across a screen of similar dots. The halo carries
       * the visibility and the ring carries the precision — the core stays close to the size of an
       * ordinary pin, so the thing being pointed at is not covered by the pointing.
       *
       * Added last, so the selection sits above every cluster and pin. It is deliberately absent
       * from `clickableLayerIds`: it is a drawing of something already selected, and clicking it
       * should hit the establishment underneath rather than return the same point twice.
       */
      created.addLayer({
        id: selectionHaloLayerId,
        type: 'circle',
        source: selectionSourceId,
        paint: {
          'circle-color': selectionColour,
          'circle-radius': selectionHaloRadius,
          'circle-opacity': 0.22,
          'circle-stroke-color': selectionColour,
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.5,
        },
      } as Parameters<typeof created.addLayer>[0])

      created.addLayer({
        id: selectionRingLayerId,
        type: 'circle',
        source: selectionSourceId,
        paint: {
          'circle-color': selectionColour,
          'circle-radius': selectionRingRadius,
          // White, and thick. The basemap is pale and covered in coloured dots; the one thing none
          // of them has is a heavy light outline, which is what makes this one findable.
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3.5,
        },
      } as Parameters<typeof created.addLayer>[0])

    })

    map.current = created

    return () => {
      created.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- constructed once; see above.
  }, [])

  // Moves the camera when the caller asks, and only then — keyed on the request rather than on
  // where it points, so asking twice for the same establishment moves twice. See `focusOn`.
  const focusLatitude = focusOn?.latitude ?? null
  const focusLongitude = focusOn?.longitude ?? null
  const focusToken = focusOn?.token ?? null

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
    // The token is the trigger and the coordinates are read when it fires. Listing them as
    // dependencies as well would be misleading: they are not what decides whether to move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken])

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

  /**
   * The selected establishment, written into its own source.
   *
   * Keyed on the coordinates and the state rather than on object identity, so a re-render carrying
   * an equal selection does not rewrite the source. One feature either way — this is the cheapest
   * write the map takes.
   */
  const selectedLatitude = selection?.latitude ?? null
  const selectedLongitude = selection?.longitude ?? null
  const selectedState = selection?.state ?? null

  useEffect(() => {
    const target = map.current
    const source = target?.getSource(selectionSourceId) as GeoJSONSource | undefined

    if (source === undefined) {
      return
    }

    if (selectedLatitude === null || selectedLongitude === null || selectedState === null) {
      source.setData(noSelection)
      return
    }

    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 0,
          geometry: { type: 'Point', coordinates: [selectedLongitude, selectedLatitude] },
          properties: {
            id: 0,
            name: '',
            state: selectedState,
            closed: false,
            severity: 0,
          },
        },
      ],
    })
  }, [selectedLatitude, selectedLongitude, selectedState])

  /**
   * The off-screen indicator: where the selection is, when it is not on screen.
   *
   * ## Why this is written to the DOM directly rather than through React state
   *
   * It has to update on every frame of a pan or a rotate. Putting the position in state would run a
   * React render per frame during exactly the gesture this project has spent the most effort keeping
   * smooth. Writing one `transform` to one node costs nothing and cannot cascade.
   *
   * ## Why the angle is right for a rotated map
   *
   * `map.project` converts a coordinate to a pixel in the container, and it already accounts for
   * bearing, pitch and zoom. So the angle from the container's centre to that pixel is the angle on
   * screen — rotate the map and the arrow follows, with no bearing arithmetic here at all.
   *
   * The indicator is then placed where that ray leaves the container: scale the direction until it
   * meets whichever edge it reaches first, which is the smaller of the two axis ratios.
   */
  const indicator = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const target = map.current

    if (target === null) {
      return
    }

    const node = indicator.current

    if (node === null) {
      return
    }

    const update = () => {
      if (selectedLatitude === null || selectedLongitude === null) {
        node.style.display = 'none'
        return
      }

      const container = target.getContainer()
      const width = container.clientWidth
      const height = container.clientHeight

      if (width === 0 || height === 0) {
        node.style.display = 'none'
        return
      }

      const point = target.project([selectedLongitude, selectedLatitude])

      // On screen: the dot itself is doing the pointing, and an arrow as well would be noise.
      const margin = 8
      if (
        point.x >= margin &&
        point.x <= width - margin &&
        point.y >= margin &&
        point.y <= height - margin
      ) {
        node.style.display = 'none'
        return
      }

      const centreX = width / 2
      const centreY = height / 2
      const dx = point.x - centreX
      const dy = point.y - centreY

      if (dx === 0 && dy === 0) {
        node.style.display = 'none'
        return
      }

      // Far enough in that the whole badge stays inside the map rather than half-clipped by it.
      const inset = 44
      const halfWidth = Math.max(1, centreX - inset)
      const halfHeight = Math.max(1, centreY - inset)

      const scale = Math.min(
        dx === 0 ? Infinity : halfWidth / Math.abs(dx),
        dy === 0 ? Infinity : halfHeight / Math.abs(dy),
      )

      const x = centreX + dx * scale
      const y = centreY + dy * scale

      // Screen y grows downwards, which atan2 handles as long as it is not "corrected" — the angle
      // that comes out is already the one to rotate the arrow by.
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI

      node.style.display = 'flex'
      node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${angle}deg)`
    }

    update()

    // `move` fires per frame during a gesture; the rest cover the cases where nothing is moving but
    // the projection has changed anyway.
    target.on('move', update)
    target.on('resize', update)

    return () => {
      target.off('move', update)
      target.off('resize', update)
    }
  }, [selectedLatitude, selectedLongitude])

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

      {/*
        Which way the selected establishment is, when it is off screen — and a way back to it.

        A button rather than a decoration: it is the only thing on screen that knows where the
        selection went, and pointing without offering to go there makes it something to look at
        rather than something to use.

        Its accessible name is static while the arrow itself rotates, which is the right split — the
        direction is a visual affordance, and "return to the selected establishment" is what the
        control actually does. The arrow graphic is hidden from assistive technology because a
        rotation announced on every frame of a pan would be unusable.
      */}
      <button
        ref={indicator}
        type="button"
        className="map-offscreen"
        onClick={() => onRecentre?.()}
      >
        <span className="visually-hidden">Return to the selected establishment</span>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M2 12h16m0 0-6-6m6 6-6 6" />
        </svg>
      </button>

      {mapFailure === null ? null : (
        <p role="alert" className="map-failure">
          The map could not be drawn: {mapFailure}
        </p>
      )}
    </>
  )
}
