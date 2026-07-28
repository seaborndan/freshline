/**
 * Fetching a report, and only when one has been asked for.
 *
 * Simpler than `useEstablishments` on purpose. The map fires a request per pan and needs debouncing,
 * deduplication and a cooldown; a report is requested when somebody changes a control, which is a
 * deliberate act happening at human speed. What it does share is aborting a superseded request, so
 * that changing two filters quickly cannot let the first answer arrive last and overwrite the second.
 */

import { useEffect, useState } from 'react'
import { fetchOutcomeBreakdown } from '../api/client'
import type { OutcomeBreakdown, OutcomeBreakdownRequest } from '../api/contract'
import { ApiProblemError, isAbortError } from '../api/errors'
import { cachedReport } from './reportCache'

export interface BreakdownView {
  breakdown: OutcomeBreakdown | null
  isLoading: boolean
  failure: string | null

  /** Seconds the API asked us to wait, when it refused for rate limiting. */
  retryAfterSeconds: number | null
}

export function useOutcomeBreakdown(request: OutcomeBreakdownRequest): BreakdownView {
  const [view, setView] = useState<BreakdownView>({
    breakdown: null,
    isLoading: true,
    failure: null,
    retryAfterSeconds: null,
  })

  // Serialised, so the effect re-runs when the *contents* change rather than on every render — the
  // caller builds a fresh object each time, and an object dependency would refetch forever.
  const key = JSON.stringify(request)

  useEffect(() => {
    // Guards the state update rather than the request: the request is shared, and abandoning it
    // would reject the promise every other caller is waiting on.
    let mounted = true

    const parsed = JSON.parse(key) as OutcomeBreakdownRequest

    // Previous rows are kept while loading rather than blanked. Swapping a table for a spinner on
    // every filter change makes the page flash and loses the reader's place in it.
    setView((previous) => ({ ...previous, isLoading: true }))

    cachedReport(key, () => fetchOutcomeBreakdown(parsed))
      .then((breakdown) => {
        if (mounted) {
          setView({ breakdown, isLoading: false, failure: null, retryAfterSeconds: null })
        }
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || !mounted) {
          return
        }

        setView({
          breakdown: null,
          isLoading: false,
          // The API's own sentence. A 429 here says how many *report* requests are allowed, which is
          // a different budget from the map's and says so.
          failure: error instanceof Error ? error.message : 'The report could not be loaded.',
          retryAfterSeconds:
            error instanceof ApiProblemError ? error.retryAfterSeconds : null,
        })
      })

    return () => {
      mounted = false
    }
  }, [key])

  return view
}
