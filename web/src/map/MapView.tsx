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
import { basemapStyleUrl } from './initialView'
import { viewportOf } from './viewportOf'

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
}

export function MapView({ establishments, initialViewport, onViewportChange }: MapViewProps) {
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

    // `moveend`, not `move`. A drag fires `move` continuously — one event per frame — and every one
    // of them would start the debounce timer again; `moveend` fires once when the camera settles,
    // including at the end of MapLibre's inertial glide. The debounce downstream is for the case
    // this does not cover: several discrete gestures in quick succession, like wheel-zoom steps.
    created.on('moveend', () => {
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

  // Pushes new pins into the existing source. Guarded because the pins usually arrive *before* the
  // style has loaded, in which case there is no source to push them into yet — and the handler above
  // then picks them up from the ref. Those two paths together are what makes the ordering safe in
  // both directions; neither one is sufficient alone.
  useEffect(() => {
    const source = map.current?.getSource(sourceId) as GeoJSONSource | undefined

    source?.setData(toFeatureCollection(establishments))
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
