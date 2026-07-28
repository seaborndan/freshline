/**
 * The map page, and the one place that reconciles everything on it.
 *
 * The map reports where it is, the panel reports what was chosen, `useEstablishments` decides when
 * that combination is worth asking about, and the URL is written from it. Nothing below this holds
 * state: that is what makes a shared link reproduce the view rather than approximate it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EstablishmentFilter } from '../api/contract'
import { containsPoint, type Viewport } from '../api/viewport'
import { DetailPanel } from '../detail/DetailPanel'
import { useEstablishmentDetail } from '../detail/useEstablishmentDetail'
import { FilterPanel } from '../filters/FilterPanel'
import { hasAnyFilter } from '../filters/filterState'
import { useFilterOptions } from '../filters/useFilterOptions'
import { ResultsList } from '../list/ResultsList'
import { initialViewport } from './initialView'
import { distinctPointCount } from './geoJson'
import { Legend } from './Legend'
import { MapView } from './MapView'
import { useEstablishments, type EstablishmentsView } from './useEstablishments'
import { readUrlState, writeUrlState } from '../state/urlState'


export function MapPage() {
  // Read once. After this the URL is an output — re-reading it on every render would fight the
  // writes below, and nothing else in the application changes it.
  const initial = useRef(readUrlState(window.location.search)).current

  const [filters, setFilters] = useState<EstablishmentFilter>(initial.filters)

  /**
   * Null until the map says where it is.
   *
   * The opening box — from the URL, or the committed constant — is what the map is *told*, not what
   * it ends up showing: `fitBounds` fits that box inside the window, so the visible box is larger on
   * whichever axis has room. It is the visible box that gets fetched and written back to the URL.
   */
  const [viewport, setViewport] = useState<Viewport | null>(null)

  /**
   * The ids under the last click, and the one chosen from them.
   *
   * Two pieces of state rather than one, because a click on a stacked point selects *several*
   * establishments and none of them: the panel then shows a list to choose from. A click on a lone
   * pin does both at once. See `DetailPanel` for why answering a crowded click arbitrarily was
   * rejected.
   */
  const [candidateIds, setCandidateIds] = useState<number[]>(
    initial.selectedId === null ? [] : [initial.selectedId],
  )
  const [selectedId, setSelectedId] = useState<number | null>(initial.selectedId)

  const handleViewportChange = useCallback((next: Viewport) => setViewport(next), [])

  const handleSelect = useCallback((ids: number[]) => {
    setCandidateIds(ids)
    setSelectedId(ids.length === 1 ? ids[0] : null)
  }, [])

  /** A row in the list names exactly one establishment, so it selects rather than offering a choice. */
  const handleSelectOne = useCallback((id: number) => {
    setCandidateIds([id])
    setSelectedId(id)
  }, [])

  const handleClose = useCallback(() => {
    setCandidateIds([])
    setSelectedId(null)
  }, [])

  const options = useFilterOptions()
  const establishments = useEstablishments(viewport, filters)
  const detail = useEstablishmentDetail(selectedId)

  /**
   * The clicked establishments, taken from the pins already on screen rather than fetched again.
   *
   * The chooser needs a name and a state for each candidate, and the map response already carried
   * both — asking the API again would spend rate-limit tokens re-learning what is in memory. A link
   * opened straight at `?id=` has no pins yet, which is why a single id goes directly to the detail
   * request and never through the chooser.
   */
  const candidates = useMemo(() => {
    const items = establishments.result?.items ?? []

    return candidateIds
      .map((id) => items.find((item) => item.id === id))
      .filter((item) => item !== undefined)
  }, [candidateIds, establishments.result])

  /**
   * Where to move the camera, or null to leave it alone.
   *
   * **Set once per record that arrives, not derived from where the map is.** The difference is the
   * whole bug this shape exists to avoid, and it was reported from a browser: as a derived value it
   * read "is the chosen establishment off screen?", which is true again the moment the user drags
   * away from the place they were just taken to — so the map snapped back, once, and then behaved.
   * (Only once, because the second drag left the answer unchanged and the effect never re-ran.)
   *
   * A camera move belongs to the act of choosing something, so it is computed when the record loads
   * and never recomputed. The viewport is read through a ref for the same reason: as a dependency it
   * would re-arm this on every pan.
   */
  const [focusOn, setFocusOn] = useState<{ latitude: number; longitude: number } | null>(null)

  const viewportRef = useRef(viewport)
  viewportRef.current = viewport

  useEffect(() => {
    const record = detail.detail

    if (record === null || record.latitude === null || record.longitude === null) {
      return
    }

    // Already on screen — which is every click on a pin, and some `?id=` links. Moving the camera
    // there would yank it out from under somebody who was already looking at the thing they clicked.
    const current = viewportRef.current
    if (current !== null && containsPoint(current, record.latitude, record.longitude)) {
      return
    }

    setFocusOn({ latitude: record.latitude, longitude: record.longitude })
  }, [detail.detail])

  // The address bar follows the state, at the point the state settles. replaceState rather than
  // pushState: a history entry per pan turns the back button into an undo-my-panning key.
  useEffect(() => {
    const query = writeUrlState({ viewport, filters, selectedId })

    window.history.replaceState(null, '', `${window.location.pathname}${query}`)
  }, [viewport, filters, selectedId])

  return (
    <div className="map-page">
      <header className="map-status-bar">
        <Status view={establishments} filters={filters} />
      </header>

      <main>
        <MapView
          establishments={establishments.result?.items ?? []}
          initialViewport={initial.viewport ?? initialViewport}
          onViewportChange={handleViewportChange}
          onSelect={handleSelect}
          focusOn={focusOn}
        />

        {establishments.failure === null ? null : (
          <p role="alert" className="map-notice map-notice-failure">
            {establishments.failure.message}
            {establishments.failure.retryAfterSeconds === null
              ? ''
              : ` Waiting ${establishments.failure.retryAfterSeconds} seconds before asking again.`}
          </p>
        )}

        <div className="panels">
          <FilterPanel filters={filters} options={options} onChange={setFilters} />

          {/* The map, as text. Pins are pixels on a canvas and take no focus, so without this a
              keyboard user can reach every filter and never reach a restaurant. */}
          <ResultsList
            establishments={establishments.result?.items ?? []}
            isTruncated={establishments.result?.isTruncated ?? false}
            selectedId={selectedId}
            onSelect={handleSelectOne}
          />

          <Legend />
        </div>

        <DetailPanel
          candidates={candidates}
          view={detail}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onClose={handleClose}
        />
      </main>
    </div>
  )
}

function Status({ view, filters }: { view: EstablishmentsView; filters: EstablishmentFilter }) {
  const { result, isLoading, unaskable } = view

  // Recomputed only when the pins change, not on every loading flip. It walks every establishment
  // building a key per one; at a thousand pins that is nothing, but it is nothing that used to run
  // twice per request for no reason.
  const points = useMemo(() => (result === null ? 0 : distinctPointCount(result.items)), [result])

  // Zoomed out past what the API will answer. Said as an instruction rather than as an error,
  // because it is a place the user can get to with two scroll wheels and nothing has gone wrong.
  if (unaskable !== null) {
    return <p role="status">Zoom in to load establishments — the view is wider than one degree.</p>
  }

  if (result === null) {
    return <p role="status">{isLoading ? 'Loading establishments…' : 'Waiting for the map…'}</p>
  }

  const { items, isTruncated } = result

  // Nothing derived from a truncated response may be stated as a fact about the area: which rows
  // were dropped is arbitrary, so "1,000 places here" would be a number the data does not support.
  // "More than" is the strongest true claim available, and the point count is withheld entirely —
  // it would describe an arbitrary subset.
  if (isTruncated) {
    return (
      <p role="status">
        More than {items.length.toLocaleString('en-GB')} places here — too many to show at once. Zoom
        in to see all of them.
      </p>
    )
  }

  // An empty result means something different once a filter is on, and saying which avoids a user
  // concluding the area is empty when it is their choice that is.
  if (items.length === 0) {
    return (
      <p role="status">
        {hasAnyFilter(filters)
          ? 'Nothing in this view matches these filters.'
          : 'No establishments in this view.'}
      </p>
    )
  }

  // Both numbers, because they differ a lot and only one of them is countable on screen. Saying
  // "518 places" over about three hundred dots invites the reader to count and conclude the map is
  // wrong — see distinctPointCount.
  return (
    <p role="status">
      {items.length.toLocaleString('en-GB')} places at {points.toLocaleString('en-GB')} points —
      some addresses hold dozens.
      {isLoading ? ' Updating…' : ''}
    </p>
  )
}

