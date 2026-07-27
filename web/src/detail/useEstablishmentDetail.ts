/**
 * One establishment's full record, fetched when it is selected.
 *
 * Separate from the viewport fetching because the two answer different questions and fail
 * independently: a detail request that 404s or is throttled must not blank the map, and a map that
 * is reloading must not close the panel somebody is reading.
 *
 * It does share one thing with the map, and it is worth remembering here: **the same rate-limit
 * bucket**. ADR-0005 puts every data endpoint behind one token bucket per client, so opening
 * establishments quickly spends the same allowance panning does. That is the reason the map's
 * debounce leaves headroom rather than sitting exactly on the sustained refill rate.
 */

import { useEffect, useState } from 'react'
import { fetchEstablishment } from '../api/client'
import type { EstablishmentDetail } from '../api/contract'
import { ApiProblemError, ApiUnreachableError, isAbortError } from '../api/errors'

export interface DetailView {
  detail: EstablishmentDetail | null
  isLoading: boolean
  failure: string | null
}

export function useEstablishmentDetail(id: number | null): DetailView {
  const [detail, setDetail] = useState<EstablishmentDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (id === null) {
      setDetail(null)
      setFailure(null)
      setIsLoading(false)
      return
    }

    const controller = new AbortController()

    // Cleared rather than kept, unlike the map's pins. A panel showing the previous restaurant's
    // inspection history under the new one's name would be worse than a moment of nothing.
    setDetail(null)
    setFailure(null)
    setIsLoading(true)

    fetchEstablishment(id, controller.signal)
      .then((next) => {
        setDetail(next)
        setIsLoading(false)
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return
        }

        setIsLoading(false)

        if (error instanceof ApiProblemError) {
          setFailure(error.displayMessage)
          return
        }

        if (error instanceof ApiUnreachableError) {
          setFailure('The Freshline API could not be reached.')
          return
        }

        setFailure(error instanceof Error ? error.message : 'Something unexpected went wrong.')
      })

    return () => controller.abort()
  }, [id])

  return { detail, isLoading, failure }
}
