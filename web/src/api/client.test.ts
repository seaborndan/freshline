import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchEstablishment, fetchMap } from './client'
import { ApiProblemError, ApiUnreachableError, InvalidViewportError, isAbortError } from './errors'
import type { Viewport } from './viewport'
import detailFixture from './__fixtures__/establishment-detail.json'
import mapFixture from './__fixtures__/map-viewport.json'
import problem400 from './__fixtures__/problem-400.json'
import problem429 from './__fixtures__/problem-429.json'

const viewport: Viewport = {
  minLatitude: 40.6,
  maxLatitude: 40.8,
  minLongitude: -74.2,
  maxLongitude: -73.9,
}

function stubFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  )

  vi.stubGlobal('fetch', fetchStub)

  return fetchStub
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

/** The URL the stub was called with, parsed. */
function requestedUrl(fetchStub: ReturnType<typeof vi.fn>): URL {
  return new URL(fetchStub.mock.calls[0][0] as string)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchMap', () => {
  it('sends all four bounds, because the API requires all four', async () => {
    const fetchStub = stubFetch(jsonResponse(mapFixture))

    await fetchMap({ viewport })

    const url = requestedUrl(fetchStub)
    expect(url.pathname).toBe('/api/v1/establishments/map')
    expect(url.searchParams.get('minLat')).toBe('40.600000')
    expect(url.searchParams.get('maxLat')).toBe('40.800000')
    expect(url.searchParams.get('minLon')).toBe('-74.200000')
    expect(url.searchParams.get('maxLon')).toBe('-73.900000')
  })

  it('sends the limit explicitly rather than relying on the server default', async () => {
    const fetchStub = stubFetch(jsonResponse(mapFixture))

    await fetchMap({ viewport })

    expect(requestedUrl(fetchStub).searchParams.get('limit')).toBe('1000')
  })

  it('sends no filter parameters when there are no filters', async () => {
    const fetchStub = stubFetch(jsonResponse(mapFixture))

    await fetchMap({ viewport })

    const url = requestedUrl(fetchStub)
    expect(url.searchParams.has('cuisine')).toBe(false)
    expect(url.searchParams.has('outcome')).toBe(false)
    expect(url.searchParams.has('awaitingFirstInspection')).toBe(false)
  })

  // An empty parameter is not an absent one: `?cuisine=` asks the API for an exact match against
  // the empty string, which nothing has, so the map would come back empty.
  it('omits an empty name filter rather than sending an empty parameter', async () => {
    const fetchStub = stubFetch(jsonResponse(mapFixture))

    await fetchMap({ viewport, filter: { nameContains: '' } })

    expect(requestedUrl(fetchStub).searchParams.has('nameContains')).toBe(false)
  })

  it('sends the outcome as its name, never as a number', async () => {
    const fetchStub = stubFetch(jsonResponse(mapFixture))

    await fetchMap({ viewport, filter: { outcome: 'Poor', awaitingFirstInspection: false } })

    const url = requestedUrl(fetchStub)
    expect(url.searchParams.get('outcome')).toBe('Poor')
    expect(url.searchParams.get('awaitingFirstInspection')).toBe('false')
  })

  // ADR-0005: the read endpoints are anonymous by decision. The API has a test per endpoint proving
  // it answers without a token; this is the same guard from the other side, so that a token cannot
  // arrive here by drift.
  it('sends no Authorization header', async () => {
    const fetchStub = stubFetch(jsonResponse(mapFixture))

    await fetchMap({ viewport })

    const init = fetchStub.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('authorization')
    expect(init.credentials).toBeUndefined()
  })

  it('returns the validated body', async () => {
    stubFetch(jsonResponse(mapFixture))

    const result = await fetchMap({ viewport })

    expect(result.items).toHaveLength(5)
    expect(result.isTruncated).toBe(false)
  })

  it('refuses a viewport the API is known to reject, without spending a request', async () => {
    const fetchStub = stubFetch(jsonResponse(mapFixture))

    await expect(
      fetchMap({ viewport: { ...viewport, maxLatitude: 42 } }),
    ).rejects.toThrow(InvalidViewportError)

    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('reports the server sentence from a ProblemDetails failure', async () => {
    stubFetch(jsonResponse(problem400, { status: 400 }))

    const error = await fetchMap({ viewport }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ApiProblemError)
    const problem = error as ApiProblemError
    expect(problem.status).toBe(400)
    expect(problem.displayMessage).toBe(
      'All four of minLat, maxLat, minLon and maxLon are required.',
    )
    expect(problem.isThrottled).toBe(false)
  })

  // The 429 is a normal response to design for on a map, not an exceptional one: 60 burst, 30 per
  // 10 seconds, and a drag produces requests in bursts.
  it('reads Retry-After from a 429 and does not retry it', async () => {
    const fetchStub = stubFetch(
      jsonResponse(problem429, { status: 429, headers: { 'Retry-After': '10' } }),
    )

    const error = await fetchMap({ viewport }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ApiProblemError)
    const problem = error as ApiProblemError
    expect(problem.isThrottled).toBe(true)
    expect(problem.retryAfterSeconds).toBe(10)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  // What an ingress in front of the API sends when it fails on its own account: not ProblemDetails,
  // and not JSON at all. The status is still worth reporting.
  it('survives an error body that is not JSON', async () => {
    stubFetch(new Response('<html>502 Bad Gateway</html>', { status: 502 }))

    const error = await fetchMap({ viewport }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ApiProblemError)
    expect((error as ApiProblemError).status).toBe(502)
    expect((error as ApiProblemError).displayMessage).toContain('502')
  })

  it('distinguishes an unreachable API from one that answered', async () => {
    stubFetch(new TypeError('Failed to fetch'))

    await expect(fetchMap({ viewport })).rejects.toBeInstanceOf(ApiUnreachableError)
  })

  // Every pan cancels the request the previous pan started, so aborts are the normal case here.
  // They must stay recognisable rather than arriving as "the API is down".
  it('lets an abort through untouched', async () => {
    const abort = new Error('The operation was aborted.')
    abort.name = 'AbortError'
    stubFetch(abort)

    const error = await fetchMap({ viewport }).catch((thrown: unknown) => thrown)

    expect(isAbortError(error)).toBe(true)
    expect(error).not.toBeInstanceOf(ApiUnreachableError)
  })

  it('passes the abort signal to fetch', async () => {
    const fetchStub = stubFetch(jsonResponse(mapFixture))
    const controller = new AbortController()

    await fetchMap({ viewport }, controller.signal)

    expect((fetchStub.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })
})

describe('fetchEstablishment', () => {
  it('asks for one establishment by id and validates what comes back', async () => {
    const fetchStub = stubFetch(jsonResponse(detailFixture))

    const detail = await fetchEstablishment(21)

    expect(requestedUrl(fetchStub).pathname).toBe('/api/v1/establishments/21')
    expect(detail.name).toBe('POPEYES')
    expect(detail.inspections).toHaveLength(3)
  })

  it('reports a 404 as the API worded it', async () => {
    stubFetch(
      jsonResponse(
        { title: 'Establishment not found', status: 404, detail: 'No establishment has id 999999.' },
        { status: 404 },
      ),
    )

    const error = await fetchEstablishment(999999).catch((thrown: unknown) => thrown)

    expect((error as ApiProblemError).status).toBe(404)
    expect((error as ApiProblemError).displayMessage).toBe('No establishment has id 999999.')
  })
})
