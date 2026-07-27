/**
 * The fetching policy for a map that follows the user.
 *
 * A viewport goes in, pins come out, and everything between them is a decision about how often to
 * ask a rate-limited API a question the user is still in the middle of asking.
 *
 * ## The four rules, and why each exists
 *
 * **1. Wait until the movement stops, then wait a little longer.** The map reports `moveend`, which
 * already collapses a whole drag into one event, but a series of wheel-zoom steps or a stuttering
 * pan produces several in a row. The debounce below collapses those too.
 *
 * **2. Cancel the request the last viewport started.** Its answer describes a box the user is no
 * longer looking at. Aborting is also the only way to stop a slow response arriving *after* a fast
 * one and overwriting it with older pins.
 *
 * **3. Never ask the same question twice.** Viewports are compared on the rounded coordinates that
 * actually go on the wire, so a click that does not move the camera, or a zoom that lands back where
 * it started, costs nothing.
 *
 * **4. Do not send a request the API is known to refuse.** Zoomed out past a degree, the answer is a
 * `400`, and spending a rate-limit token to be told so is waste — the whole dataset spans 0.41° by
 * 0.55°, so a viewport that large is a user who has zoomed past the entire city.
 *
 * ## Why 400 milliseconds
 *
 * Not a round number picked for feeling right. The limiter is a token bucket of **60**, refilling
 * **30 every 10 seconds** — three requests per second sustained — with `QueueLimit = 0`, so a
 * request over the line is refused immediately rather than delayed. And it is **one bucket for every
 * data endpoint** (ADR-0005), so the map is not spending alone: every detail-panel request comes out
 * of the same allowance.
 *
 * 400ms caps a user who does nothing but wiggle the map at 2.5 requests per second, which stays
 * under the sustained refill and leaves the rest for the detail panel. It is also short enough to
 * feel immediate: the map has already stopped moving, and a further 400ms reads as the request
 * taking a moment rather than as the interface being slow.
 *
 * The burst of 60 is what absorbs normal use — a person exploring a map produces a request every few
 * seconds, not every few hundred milliseconds.
 */

import { useEffect, useRef, useState } from 'react'
import { fetchMap } from '../api/client'
import type { EstablishmentFilter, MapResult } from '../api/contract'
import { ApiProblemError, ApiUnreachableError, isAbortError } from '../api/errors'
import { viewportKey, viewportProblem, type Viewport } from '../api/viewport'

/** See the note above. Exported so a test can state it rather than wait for it. */
export const debounceMilliseconds = 400

export interface Failure {
  message: string
  /** Present only when the API said 429. */
  retryAfterSeconds: number | null
}

export interface EstablishmentsView {
  /**
   * The last result that arrived, kept while the next one is in flight.
   *
   * Deliberately not cleared on every pan. Blanking the map between viewports produces a flicker on
   * every movement and, worse, an empty map that is indistinguishable from an area with nothing in
   * it. Stale pins that are about to be replaced are the better lie for a few hundred milliseconds.
   */
  result: MapResult | null

  isLoading: boolean

  failure: Failure | null

  /**
   * Set when the viewport is one the API will not answer — in practice, zoomed out past a degree.
   * Carries the reason so the UI can say which rule was broken.
   */
  unaskable: string | null
}

function describe(error: unknown): Failure {
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

  return {
    message: error instanceof Error ? error.message : 'Something unexpected went wrong.',
    retryAfterSeconds: null,
  }
}

export function useEstablishments(
  viewport: Viewport | null,
  filter?: EstablishmentFilter,
): EstablishmentsView {
  const [result, setResult] = useState<MapResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  /**
   * The viewport whose answer is already on screen or already in flight. Compared on the rounded
   * key, which is what the request is actually built from.
   */
  const requested = useRef<string | null>(null)

  /**
   * When the rate limiter said to come back, as a timestamp.
   *
   * Nothing here retries — that stays true, and it is why a throttled client does not turn a limit
   * into an outage. What this does is refuse to *send* until the limiter would accept it, so a user
   * who keeps panning through a cooldown does not spend the whole time collecting 429s. The request
   * that eventually goes is still the one the user's last movement asked for.
   */
  const throttledUntil = useRef(0)

  const unaskable = viewport === null ? null : viewportProblem(viewport)

  const key = viewport === null || unaskable !== null ? null : viewportKey(viewport)

  // The filter is part of the question, so a filter change re-asks it even from an identical
  // viewport. Serialised rather than compared by reference because callers build a fresh object.
  const filterKey = JSON.stringify(filter ?? {})

  useEffect(() => {
    if (viewport === null || key === null) {
      return
    }

    if (requested.current === `${key}|${filterKey}`) {
      return
    }

    const controller = new AbortController()

    // A cooldown extends the wait rather than replacing it, so the debounce still applies on the way
    // out of one.
    const wait = Math.max(debounceMilliseconds, throttledUntil.current - Date.now())

    const timer = setTimeout(() => {
      requested.current = `${key}|${filterKey}`
      setIsLoading(true)

      fetchMap({ viewport, filter }, controller.signal)
        .then((next) => {
          setResult(next)
          setFailure(null)
          setIsLoading(false)
        })
        .catch((error: unknown) => {
          // A superseded request. The viewport that replaced it owns the state now, and reporting
          // this one would overwrite a fresher answer with an older failure.
          if (isAbortError(error)) {
            return
          }

          const described = describe(error)

          if (described.retryAfterSeconds !== null) {
            throttledUntil.current = Date.now() + described.retryAfterSeconds * 1000
          }

          // Allow the same viewport to be asked again after a failure — otherwise a single 429
          // would make that box permanently unfetchable for as long as the user stayed on it.
          requested.current = null

          setFailure(described)
          setIsLoading(false)
        })
    }, wait)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, filterKey, viewport, filter])

  return { result, isLoading, failure, unaskable }
}
