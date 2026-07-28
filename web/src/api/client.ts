/**
 * The only place in this application that calls `fetch`.
 *
 * Everything it knows how to do is here: build a query string, send one request, turn a failure into
 * one of four errors, and hand the success to `validate.ts` before anyone sees it.
 *
 * **No token, no `Authorization` header, no credentials.** The read endpoints are anonymous by
 * decision, not by omission — ADR-0005. There is no login, no auth state and no 401 path to handle,
 * and `credentials` stays at the default `'same-origin'` so no cookie is ever sent cross-origin.
 *
 * **Nothing here retries.** Not the 429, for the reason in `errors.ts`, and not a network failure
 * either — a map that silently repeats a request the user did not make burns their rate-limit budget
 * on their behalf. Retrying is the caller's choice, made once, in response to something a person did.
 */

import type {
  DatasetSummary,
  OutcomeBreakdown,
  OutcomeBreakdownRequest,
  EstablishmentReport,
  EstablishmentReportRequest,
  EstablishmentDetail,
  EstablishmentFilter,
  EstablishmentFilterOptions,
  MapResult,
} from './contract'
import {
  ApiProblemError,
  ApiUnreachableError,
  InvalidViewportError,
  isAbortError,
  type ProblemDetails,
} from './errors'
import {
  readDatasetSummary,
  readOutcomeBreakdown,
  readEstablishmentReport,
  readEstablishmentDetail,
  readFilterOptions,
  readMapResult,
} from './validate'
import { formatCoordinate, viewportProblem, type Viewport } from './viewport'

/**
 * Where the API is.
 *
 * **Deliberately not a Vite dev proxy**, which was the alternative and is the more comfortable one.
 * A proxy makes the browser see one origin and removes CORS from development entirely — which is the
 * problem with it: CORS is a production condition, and hiding it locally means the first time anyone
 * meets it is on the deployed URL, as a console error, with a different tool chain to debug it in.
 * The API already allows `http://localhost:5173` from a committed default in `CrossOriginPolicy`, so
 * the honest arrangement costs nothing and exercises the real path on every request.
 *
 * The deployed value is `VITE_API_BASE_URL`, substituted at build time. The fallback is the
 * `dotnet run` address from `docs/local-development.md`, and it is **guarded by `DEV` rather than
 * left unconditional**: a production bundle built without the variable would otherwise ask
 * `http://localhost:5045` — the visitor's own machine — for its data, on a real deployed URL, failing
 * in a way indistinguishable from the API being down. `vite.config.ts` fails the build for the same
 * reason, so this line is the second of two chances to catch it rather than the only one.
 *
 * The production branch is the empty string, which makes `apiRoot` the relative `/api/v1` and sends
 * requests to the site's own origin. It is still wrong — the API is a separate origin and will stay
 * one — but it is wrong *visibly*, as a 404 from the site the user is on, surfaced by the existing
 * unreachable-API message. Pointing at the visitor's localhost is the failure worth engineering
 * away; a same-origin 404 is a failure that describes itself.
 */
const configuredBaseUrl: string | undefined = import.meta.env.VITE_API_BASE_URL

const baseUrl: string = configuredBaseUrl ?? (import.meta.env.DEV ? 'http://localhost:5045' : '')

const apiRoot = `${baseUrl.replace(/\/+$/, '')}/api/v1`

/**
 * Pins per viewport request.
 *
 * Sent explicitly rather than left to the server's default, so this number is visible in this
 * repository and changing it is a change someone can read. It is the server's current default and
 * it is not yet a measured choice — slice 3 picks it against `isTruncated` at the zoom levels the
 * map actually opens at.
 */
export const defaultMapLimit = 1000

export interface MapRequest {
  viewport: Viewport
  filter?: EstablishmentFilter
  limit?: number
}

function buildMapUrl(request: MapRequest): string {
  const { viewport, filter, limit } = request

  const query = new URLSearchParams({
    minLat: formatCoordinate(viewport.minLatitude),
    maxLat: formatCoordinate(viewport.maxLatitude),
    minLon: formatCoordinate(viewport.minLongitude),
    maxLon: formatCoordinate(viewport.maxLongitude),
    limit: String(limit ?? defaultMapLimit),
  })

  appendFilter(query, filter)

  return `${apiRoot}/establishments/map?${query.toString()}`
}

/**
 * Absent filters are absent parameters, never empty ones. `?cuisine=` is not "no cuisine filter" to
 * this API — it is an exact match against the empty string, which nothing has.
 *
 * `outcome` goes on the wire as its name, matching how the API serialises it. Nothing here maps an
 * outcome to a number.
 */
function appendFilter(query: URLSearchParams, filter: EstablishmentFilter | undefined): void {
  if (filter === undefined) {
    return
  }

  if (filter.nameStartsWith !== undefined && filter.nameStartsWith !== '') {
    query.set('nameStartsWith', filter.nameStartsWith)
  }

  if (filter.cuisine !== undefined) {
    query.set('cuisine', filter.cuisine)
  }

  if (filter.locality !== undefined) {
    query.set('locality', filter.locality)
  }

  if (filter.outcome !== undefined) {
    query.set('outcome', filter.outcome)
  }

  if (filter.awaitingFirstInspection !== undefined) {
    query.set('awaitingFirstInspection', String(filter.awaitingFirstInspection))
  }
}

/**
 * Everything inside a viewport.
 *
 * Throws `InvalidViewportError` without sending anything when the API is already known to refuse the
 * box. The rate limiter is real and applies in development too, and a map spends its budget in
 * bursts while the user drags.
 */
export async function fetchMap(request: MapRequest, signal?: AbortSignal): Promise<MapResult> {
  const problem = viewportProblem(request.viewport)

  if (problem !== null) {
    throw new InvalidViewportError(problem)
  }

  const body = await requestJson(buildMapUrl(request), signal)

  return readMapResult(body, request.viewport)
}

/**
 * The values the cuisine and locality filters can match.
 *
 * Fetched once, at startup. The vocabulary changes only when ingestion runs, and re-asking on every
 * filter change would spend rate-limit tokens on an answer that cannot have changed — out of the
 * same bucket the map is panning on.
 */
export async function fetchFilterOptions(signal?: AbortSignal): Promise<EstablishmentFilterOptions> {
  return readFilterOptions(await requestJson(`${apiRoot}/establishments/filter-options`, signal))
}

/**
 * Counts describing the whole dataset, for the landing page.
 *
 * Fetched once. Like the filter vocabulary, these change only when ingestion runs, and they are the
 * first request a visitor causes — so it is worth being the cheapest one the API answers.
 */
export async function fetchDatasetSummary(signal?: AbortSignal): Promise<DatasetSummary> {
  return readDatasetSummary(await requestJson(`${apiRoot}/establishments/summary`, signal))
}

/**
 * How inspection results distribute across boroughs or cuisines.
 *
 * Spends the API's *report* budget rather than the map's — a separate, smaller token bucket, because
 * a report costs many times what a viewport query costs. A 429 here means too many reports, not too
 * much panning, and the message says so.
 */
export async function fetchOutcomeBreakdown(
  request: OutcomeBreakdownRequest,
  signal?: AbortSignal,
): Promise<OutcomeBreakdown> {
  const params = new URLSearchParams({ dimension: request.dimension })

  // Only parameters with a value are sent. An empty string is an exact match against the empty
  // string, which no cuisine or borough has, so sending one would silently return nothing.
  if (request.locality !== undefined && request.locality !== '') {
    params.set('locality', request.locality)
  }

  if (request.cuisine !== undefined && request.cuisine !== '') {
    params.set('cuisine', request.cuisine)
  }

  if (request.inspectedFrom !== undefined && request.inspectedFrom !== '') {
    params.set('inspectedFrom', request.inspectedFrom)
  }

  if (request.inspectedTo !== undefined && request.inspectedTo !== '') {
    params.set('inspectedTo', request.inspectedTo)
  }

  return readOutcomeBreakdown(
    await requestJson(`${apiRoot}/reports/outcome-breakdown?${params}`, signal),
  )
}

/**
 * The establishments themselves, filtered — the row-level report.
 *
 * Spends the report budget, like the breakdown. Bounded rather than paged, so a wide filter comes
 * back truncated and the caller is told.
 */
export async function fetchEstablishmentReport(
  request: EstablishmentReportRequest,
  signal?: AbortSignal,
): Promise<EstablishmentReport> {
  const params = new URLSearchParams()

  if (request.locality) params.set('locality', request.locality)
  if (request.cuisine) params.set('cuisine', request.cuisine)
  if (request.outcome) params.set('outcome', request.outcome)
  if (request.inspectedFrom) params.set('inspectedFrom', request.inspectedFrom)
  if (request.inspectedTo) params.set('inspectedTo', request.inspectedTo)

  // Explicitly compared to undefined: false is a meaningful value here — "exclude never-inspected"
  // — and a truthiness check would drop it.
  if (request.awaitingFirstInspection !== undefined) {
    params.set('awaitingFirstInspection', String(request.awaitingFirstInspection))
  }

  const query = params.toString()

  return readEstablishmentReport(
    await requestJson(`${apiRoot}/reports/establishments${query === '' ? '' : `?${query}`}`, signal),
  )
}

/** One establishment with its full inspection history. */
export async function fetchEstablishment(
  id: number,
  signal?: AbortSignal,
): Promise<EstablishmentDetail> {
  const body = await requestJson(`${apiRoot}/establishments/${id}`, signal)

  return readEstablishmentDetail(body)
}

async function requestJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    // An abort is not a failure — it is this client cancelling a request the user superseded by
    // panning. It travels up untouched so callers can ignore it by name.
    if (isAbortError(error)) {
      throw error
    }

    // `fetch` rejects with a TypeError for every transport-level problem and deliberately tells the
    // page nothing more: connection refused, DNS, and a CORS rejection are one indistinguishable
    // failure by design, so the message here cannot be more specific than it is.
    throw new ApiUnreachableError(error)
  }

  if (!response.ok) {
    throw new ApiProblemError(
      response.status,
      await readProblemDetails(response),
      readRetryAfterSeconds(response),
    )
  }

  return await response.json()
}

/**
 * Every failure from this API is ProblemDetails — 400, 404 and the 429 alike. This still tolerates a
 * body that is not, because the response in front of the API on the deployed URL will not be: an
 * ingress returning its own 502 or 504 sends HTML, and the client should report a status rather than
 * throw a parse error over it.
 */
async function readProblemDetails(response: Response): Promise<ProblemDetails> {
  try {
    const body: unknown = await response.json()

    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      return body as ProblemDetails
    }
  } catch {
    // Not JSON. The status is still worth reporting.
  }

  return {}
}

/**
 * `Retry-After: 10` — the API sends delta-seconds.
 *
 * RFC 9110 also permits an HTTP-date, which is not parsed here: this client talks to one API, that
 * API's rate limiter writes seconds, and a date would need `Date.parse` and a clock-skew argument to
 * be worth anything. An unrecognised value reads as null and the UI says "try again shortly".
 */
function readRetryAfterSeconds(response: Response): number | null {
  const header = response.headers.get('Retry-After')

  if (header === null) {
    return null
  }

  const seconds = Number(header)

  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null
}
