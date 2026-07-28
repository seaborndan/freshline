import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedReport, clearReportCache } from './reportCache'

beforeEach(() => {
  clearReportCache()
})

describe('cachedReport', () => {
  /**
   * The reported problem, at its root: leaving a filtered report and pressing Back asked the API the
   * same question again, for an answer that could not have changed in the intervening seconds.
   */
  it('asks once for the same question', async () => {
    const load = vi.fn().mockResolvedValue('answer')

    await cachedReport('a', load)
    await cachedReport('a', load)

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('asks again when the question changes', async () => {
    const load = vi.fn().mockResolvedValue('answer')

    await cachedReport('a', load)
    await cachedReport('b', load)

    expect(load).toHaveBeenCalledTimes(2)
  })

  /**
   * The promise is cached, not just the value — so two components mounting together share one
   * request rather than racing to make two. This is also what removes the duplicate React's
   * StrictMode produces in development.
   */
  it('shares one request between callers that arrive together', async () => {
    const load = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('answer'), 10)),
    )

    const [first, second] = await Promise.all([
      cachedReport('a', load),
      cachedReport('a', load),
    ])

    expect(load).toHaveBeenCalledTimes(1)
    expect(first).toBe('answer')
    expect(second).toBe(second)
  })

  /**
   * A failure is not kept. Caching one would leave a report permanently broken for the session
   * because of a single bad moment — a rate limit, a dropped connection — with no way back but a
   * reload.
   */
  it('does not remember a failure', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('too many requests'))
      .mockResolvedValue('answer')

    await expect(cachedReport('a', load)).rejects.toThrow('too many requests')
    await expect(cachedReport('a', load)).resolves.toBe('answer')

    expect(load).toHaveBeenCalledTimes(2)
  })
})
