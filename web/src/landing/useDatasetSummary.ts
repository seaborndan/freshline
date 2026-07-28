/**
 * The dataset's headline counts, fetched once.
 *
 * Kept deliberately plain — one request, no debounce, no dedupe, no cooldown. `useEstablishments`
 * has all of those because the map fires a request per pan; this fires one per visit to the landing
 * page and the machinery would be answering a problem that does not exist here.
 */

import { useEffect, useState } from 'react'
import { fetchDatasetSummary } from '../api/client'
import type { DatasetSummary } from '../api/contract'
import { isAbortError } from '../api/errors'

export interface SummaryView {
  summary: DatasetSummary | null
  isLoading: boolean

  /**
   * The API's own sentence, or null.
   *
   * Surfaced rather than swallowed. The landing page can survive without these numbers — it still
   * says what the site is — so a failure here degrades the page rather than replacing it, and the
   * reason is shown instead of a spinner that never resolves.
   */
  failure: string | null
}

export function useDatasetSummary(): SummaryView {
  const [view, setView] = useState<SummaryView>({
    summary: null,
    isLoading: true,
    failure: null,
  })

  useEffect(() => {
    const controller = new AbortController()

    fetchDatasetSummary(controller.signal)
      .then((summary) => setView({ summary, isLoading: false, failure: null }))
      .catch((error: unknown) => {
        // An abort is this effect being cleaned up, not a failure. Reporting it would flash an error
        // on a page the user has already left, and in React's development strict mode it would show
        // on every first render.
        if (isAbortError(error)) {
          return
        }

        setView({
          summary: null,
          isLoading: false,
          failure: error instanceof Error ? error.message : 'The summary could not be loaded.',
        })
      })

    return () => controller.abort()
  }, [])

  return view
}
