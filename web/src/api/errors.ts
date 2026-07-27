/**
 * Four ways a request can fail, kept apart because the UI says something different about each and
 * a single `Error` would force it to guess by reading a message string.
 *
 * - `ApiProblemError` — the API answered, and the answer was no. It has a status and a sentence
 *   written by the server.
 * - `ApiUnreachableError` — nothing answered. Wrong port, API not running, DNS, or the browser
 *   refusing the response for a CORS reason, which is indistinguishable from here by design.
 * - `ApiContractError` — the API answered 200 and the body was not what the contract says. This is
 *   a bug in code this repository owns, on one side or the other.
 * - `InvalidViewportError` — the caller asked for a viewport the API is known to refuse. Thrown
 *   before the request is sent.
 *
 * No `enum` and no constructor parameter properties anywhere in here: `erasableSyntaxOnly` is on in
 * `tsconfig.app.json`, so any TypeScript that emits runtime code is a compile error.
 */

/**
 * RFC 9457 ProblemDetails, as this API actually sends it.
 *
 * Every member is optional, and that is not defensiveness — it is what the captured fixtures show.
 * The 400 carries `type`, `title`, `status`, `detail` and `traceId`; **the 429 carries no `type`**,
 * because it is written by the rate limiter rather than by `TypedResults.Problem`. A parser that
 * requires `type` handles every error this API produces except the one that happens under load.
 */
export interface ProblemDetails {
  type?: string
  title?: string
  status?: number
  detail?: string
  traceId?: string
}

/** The API answered with a failure status and a ProblemDetails body. */
export class ApiProblemError extends Error {
  readonly status: number
  readonly problem: ProblemDetails

  /**
   * Seconds to wait, from the `Retry-After` header. Present on a 429 and null otherwise.
   *
   * Surfaced so the UI can say when to try again — and deliberately not acted on. Nothing in this
   * client retries. A throttled client that retries automatically is how a rate limit becomes an
   * outage: every rejected caller comes back at once, and the limiter that was protecting the
   * database is now amplifying the load against it.
   */
  readonly retryAfterSeconds: number | null

  constructor(status: number, problem: ProblemDetails, retryAfterSeconds: number | null) {
    super(problem.title ?? `The API returned ${status}.`)
    this.name = 'ApiProblemError'
    this.status = status
    this.problem = problem
    this.retryAfterSeconds = retryAfterSeconds
  }

  /** True when the caller is being throttled. */
  get isThrottled(): boolean {
    return this.status === 429
  }

  /**
   * The sentence to show a user. The server's `detail` is written for exactly this and is more
   * specific than anything that could be composed here — "All four of minLat, maxLat, minLon and
   * maxLon are required" beats "Bad request".
   */
  get displayMessage(): string {
    return this.problem.detail ?? this.problem.title ?? `The API returned ${this.status}.`
  }
}

/** Nothing answered. */
export class ApiUnreachableError extends Error {
  constructor(cause: unknown) {
    super('The API could not be reached.')
    this.name = 'ApiUnreachableError'
    this.cause = cause
  }
}

/** The API answered 200 with a body the contract does not describe. */
export class ApiContractError extends Error {
  /** Where in the body, e.g. `items[3].latestInspection.outcome`. */
  readonly path: string

  constructor(path: string, expectation: string) {
    super(`${path}: ${expectation}`)
    this.name = 'ApiContractError'
    this.path = path
  }
}

/** The caller asked for a viewport the API is known to refuse. */
export class InvalidViewportError extends Error {
  constructor(problem: string) {
    super(problem)
    this.name = 'InvalidViewportError'
  }
}

/**
 * Whether this is the abort of a superseded request rather than a failure.
 *
 * Every pan cancels the request the last pan started, so aborts are the normal case on a map and
 * must never reach an error banner. Matched by `name` rather than by `instanceof DOMException`,
 * because jsdom and the browser do not always produce the same class for it.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
