/**
 * The page.
 *
 * Slice 2 fetches one measured viewport once, on mount, and draws it. The viewport does not yet
 * follow the map — panning changes what is visible without changing what was fetched, which is
 * slice 3's job and is called out on screen rather than left to be discovered.
 */

import { useEffect, useState } from 'react'
import { fetchMap } from './api/client'
import type { MapResult } from './api/contract'
import { ApiProblemError, ApiUnreachableError, isAbortError } from './api/errors'
import { initialViewport } from './map/initialView'
import { Legend } from './map/Legend'
import { MapView } from './map/MapView'
import './App.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; result: MapResult }
  | { status: 'failed'; message: string; retryAfterSeconds: number | null }

function describe(error: unknown): { message: string; retryAfterSeconds: number | null } {
  if (error instanceof ApiProblemError) {
    return { message: error.displayMessage, retryAfterSeconds: error.retryAfterSeconds }
  }

  if (error instanceof ApiUnreachableError) {
    return {
      message:
        'The Freshline API could not be reached. If you are running this locally, check that the ' +
        'API is started.',
      retryAfterSeconds: null,
    }
  }

  // Anything else is a contract failure — the API answered and the answer was not what it promised.
  // Worth showing rather than hiding, because it means one side of this repository has a bug.
  return {
    message: error instanceof Error ? error.message : 'Something unexpected went wrong.',
    retryAfterSeconds: null,
  }
}

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    fetchMap({ viewport: initialViewport }, controller.signal)
      .then((result) => setState({ status: 'loaded', result }))
      .catch((error: unknown) => {
        // A cancelled request is this component unmounting, not a failure to report.
        if (isAbortError(error)) {
          return
        }

        setState({ status: 'failed', ...describe(error) })
      })

    return () => controller.abort()
  }, [])

  return (
    <div className="app-shell">
      <header>
        <div>
          <h1>Freshline</h1>
          <p className="tagline">
            Health-inspection results for New York City restaurants, on a map.
          </p>
        </div>
        <Status state={state} />
      </header>

      <main>
        {state.status === 'failed' ? (
          <p role="alert" className="failure">
            {state.message}
            {state.retryAfterSeconds === null
              ? ''
              : ` Try again in ${state.retryAfterSeconds} seconds.`}
          </p>
        ) : (
          <MapView
            establishments={state.status === 'loaded' ? state.result.items : []}
            initialViewport={initialViewport}
          />
        )}

        <Legend />
      </main>
    </div>
  )
}

function Status({ state }: { state: LoadState }) {
  if (state.status === 'loading') {
    return <p role="status">Loading establishments…</p>
  }

  if (state.status === 'failed') {
    return null
  }

  const { items, isTruncated } = state.result

  // Nothing derived from a truncated response may be stated as a fact about the area: which rows
  // were dropped is arbitrary, so "1,000 places here" would be a number the data does not support.
  // "At least" is the strongest true claim available.
  if (isTruncated) {
    return (
      <p role="status">
        Showing at least {items.length.toLocaleString('en-GB')} places — more than fit in one
        request. Zoom in to see them all.
      </p>
    )
  }

  if (items.length === 0) {
    return <p role="status">No establishments in this area.</p>
  }

  return (
    <p role="status">
      {items.length.toLocaleString('en-GB')} places around Times Square. Panning does not load more
      yet.
    </p>
  )
}

export default App
