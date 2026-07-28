/**
 * The cuisine and borough vocabularies, fetched once at startup.
 *
 * Once, not per filter change: this list changes only when ingestion runs, and re-asking would spend
 * rate-limit tokens on an answer that cannot have changed — out of the same bucket the map is
 * panning on.
 *
 * A failure here is deliberately quiet. If the vocabulary cannot be fetched the two dropdowns stay
 * disabled and everything else — the map, the name filter, the never-inspected filter — keeps
 * working. Taking the page down because a dropdown could not be populated would be the tail wagging
 * the dog.
 */

import { useEffect, useState } from 'react'
import { fetchFilterOptions } from '../api/client'
import type { EstablishmentFilterOptions } from '../api/contract'
import { isAbortError } from '../api/errors'

/**
 * The vocabulary, fetched at most once for the whole session.
 *
 * ## Why a module-level cache
 *
 * Every page that filters calls this hook, so navigating between the map and the reports refetched
 * a list that **cannot have changed** — it changes when ingestion runs, not when somebody clicks a
 * link. Reported as noise in the network tab on returning to the reports page, and it was noise:
 * the same answer, asked for again.
 *
 * The in-flight promise is cached rather than only the result, so two components mounting together
 * share one request instead of racing to make two.
 *
 * ## Why the request is not aborted
 *
 * A hook that abandons this fetch on unmount would reject the promise every other component is
 * waiting on. React's StrictMode makes that the *common* path in development — it mounts,
 * unmounts and remounts every component deliberately — so an abortable shared request would fail
 * for everyone on the first render of every page. It is one small request per session; letting it
 * finish is both simpler and correct.
 */
let inFlight: Promise<EstablishmentFilterOptions> | null = null

function loadFilterOptions(): Promise<EstablishmentFilterOptions> {
  inFlight ??= fetchFilterOptions().catch((error: unknown) => {
    // Not cached, so a later page gets to try again rather than inheriting one bad moment for the
    // rest of the session.
    inFlight = null
    throw error
  })

  return inFlight
}

export function useFilterOptions(): EstablishmentFilterOptions | null {
  const [options, setOptions] = useState<EstablishmentFilterOptions | null>(null)

  useEffect(() => {
    // Guards the state update rather than the request — see above for why the fetch itself is left
    // to finish.
    let mounted = true

    loadFilterOptions()
      .then((loaded) => {
        if (mounted) {
          setOptions(loaded)
        }
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || !mounted) {
          return
        }

        // Left null, which the panel renders as two disabled dropdowns. The map's own error
        // reporting covers the case where the API is unreachable altogether.
        setOptions(null)
      })

    return () => {
      mounted = false
    }
  }, [])

  return options
}
