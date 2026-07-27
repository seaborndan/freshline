/**
 * The page, and the one place that reconciles a moving map with a rate-limited API.
 *
 * The map reports where it is; `useEstablishments` decides when that is worth asking about; this
 * component holds the answer and says something true about it. Filters and the URL join this owner
 * in slice 4 — the structure is already the one that decision needs, with no state living inside the
 * map itself.
 */

import { useCallback, useState } from 'react'
import type { Viewport } from './api/viewport'
import { initialViewport } from './map/initialView'
import { distinctPointCount } from './map/geoJson'
import { Legend } from './map/Legend'
import { MapView } from './map/MapView'
import { useEstablishments, type EstablishmentsView } from './map/useEstablishments'
import './App.css'

function App() {
  /**
   * Null until the map says where it is.
   *
   * The committed initial viewport is what the map *opens* on, not what gets fetched: `fitBounds`
   * fits that box inside whatever window the browser has, so the box actually on screen is wider,
   * and taller or shorter, than the constant. Fetching the constant would draw pins for a box that
   * is not the one being looked at — noticeably, as empty margins on a wide monitor.
   */
  const [viewport, setViewport] = useState<Viewport | null>(null)

  // Stable, so it is not a fresh function on every render — MapView keeps it in a ref and calls it
  // from a handler registered once, but a changing prop would still churn that ref pointlessly.
  const handleViewportChange = useCallback((next: Viewport) => setViewport(next), [])

  const establishments = useEstablishments(viewport)

  return (
    <div className="app-shell">
      <header>
        <div>
          <h1>Freshline</h1>
          <p className="tagline">
            Health-inspection results for New York City restaurants, on a map.
          </p>
        </div>
        <Status view={establishments} />
      </header>

      <main>
        <MapView
          establishments={establishments.result?.items ?? []}
          initialViewport={initialViewport}
          onViewportChange={handleViewportChange}
        />

        {establishments.failure === null ? null : (
          <p role="alert" className="map-notice map-notice-failure">
            {establishments.failure.message}
            {establishments.failure.retryAfterSeconds === null
              ? ''
              : ` Waiting ${establishments.failure.retryAfterSeconds} seconds before asking again.`}
          </p>
        )}

        <Legend />
      </main>
    </div>
  )
}

function Status({ view }: { view: EstablishmentsView }) {
  const { result, isLoading, unaskable } = view

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
  // "At least" is the strongest true claim available, and the point count is withheld entirely —
  // it would be a count of an arbitrary subset.
  if (isTruncated) {
    return (
      <p role="status">
        More than {items.length.toLocaleString('en-GB')} places here — too many to show at once. Zoom
        in to see all of them.
      </p>
    )
  }

  if (items.length === 0) {
    return <p role="status">No establishments in this view.</p>
  }

  // Both numbers, because they differ a lot and only one of them is countable on screen. Saying
  // "518 places" over about three hundred dots invites the reader to count and conclude the map is
  // wrong — see distinctPointCount.
  return (
    <p role="status">
      {items.length.toLocaleString('en-GB')} places at {distinctPointCount(items).toLocaleString('en-GB')}{' '}
      points — some addresses hold dozens.
      {isLoading ? ' Updating…' : ''}
    </p>
  )
}

export default App
