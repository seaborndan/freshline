/**
 * Report answers, remembered for the session.
 *
 * ## Why reports are cached and the map is not
 *
 * A booked decision from `docs/milestones/m5b-landing-and-reporting.md`, implemented here:
 *
 * > Ingestion runs daily, so a report's answer is stable for a day. The map's answer changes with
 * > every pan. This is the difference that makes response caching worth having on one and not the
 * > other.
 *
 * The prompt was leaving a filtered report for an establishment and pressing Back: the page
 * remounted and asked the API the same question again, for an answer that could not have changed in
 * the intervening seconds. A report is also the most expensive thing this API answers and has the
 * smallest rate-limit budget, so repeating one is the worst request to repeat.
 *
 * ## What is cached, and for how long
 *
 * Keyed on the request, so changing a filter is a different question and is asked. Held for the
 * lifetime of the page — a reload gets fresh data, and the underlying data changes once a day.
 *
 * **The staleness that leaves, stated rather than discovered:** a tab left open across an ingestion
 * run will keep showing the previous day's answer for any report it has already seen. That is
 * accepted because the alternative — a time-based expiry — reintroduces the refetch this exists to
 * remove, at an arbitrary interval, for data that moves once every twenty-four hours.
 *
 * ## Why the promise is cached, not just the value
 *
 * Two components asking the same question at once share one request rather than racing to make two.
 * That also removes the duplicate React's StrictMode produces in development, where every effect is
 * deliberately run twice.
 *
 * A rejected request is evicted, so a later attempt gets to try again rather than inheriting one bad
 * moment for the rest of the session.
 */

const answers = new Map<string, Promise<unknown>>()

/**
 * The answer to `key`, asking `load` only if nobody has already.
 *
 * The caller owns the key and therefore owns what counts as the same question — see the hooks, which
 * serialise their request object.
 */
export function cachedReport<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = answers.get(key) as Promise<T> | undefined

  if (existing !== undefined) {
    return existing
  }

  const pending = load().catch((error: unknown) => {
    answers.delete(key)
    throw error
  })

  answers.set(key, pending)

  return pending
}

/**
 * Forgets every cached answer.
 *
 * Exists because a module-level cache outlives the thing that filled it, and the first place that
 * bites is a test file: one test's mocked response was answering another test's question. It is a
 * real seam rather than a test-only escape hatch — anything that wants to force a refresh, such as a
 * reload button, needs exactly this.
 */
export function clearReportCache(): void {
  answers.clear()
}
