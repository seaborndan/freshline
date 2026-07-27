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

export function useFilterOptions(): EstablishmentFilterOptions | null {
  const [options, setOptions] = useState<EstablishmentFilterOptions | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    fetchFilterOptions(controller.signal)
      .then(setOptions)
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return
        }

        // Left null, which the panel renders as two disabled dropdowns. The map's own error
        // reporting covers the case where the API is unreachable altogether.
        setOptions(null)
      })

    return () => controller.abort()
  }, [])

  return options
}
