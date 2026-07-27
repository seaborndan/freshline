import { describe, expect, it } from 'vitest'
import { formatPlainDate, parsePlainDate } from './plainDate'

describe('parsePlainDate', () => {
  it('reads the three parts, with the month as a human counts them', () => {
    expect(parsePlainDate('2026-06-01')).toEqual({ year: 2026, month: 6, day: 1 })
  })

  it('rejects a string that matches the shape but is not a date', () => {
    expect(parsePlainDate('2026-13-45')).toBeNull()
  })

  it('rejects a date that is not zero-padded, because the API never sends one', () => {
    expect(parsePlainDate('2026-6-1')).toBeNull()
  })

  it('rejects a timestamp, which is a different contract', () => {
    expect(parsePlainDate('2026-06-01T00:00:00Z')).toBeNull()
  })
})

describe('formatPlainDate', () => {
  // The reason this module exists. `new Date('2026-06-01')` is UTC midnight, which is 8pm on the
  // 31st of May in New York, so anything that formats through Date renders the day before the
  // inspection happened.
  //
  // Deliberately asserted as a value rather than by comparing against `new Date` — that comparison
  // would pass on a machine in New York and be vacuously true in CI, which runs in UTC. A test that
  // only fails on some machines is worse than no test.
  it('renders the day that is in the string, not the day before it', () => {
    expect(formatPlainDate('2026-06-01')).toBe('1 June 2026')
    expect(formatPlainDate('2026-06-01')).not.toContain('May')
  })

  it('spells the month, because 01/06/2026 is two different days', () => {
    expect(formatPlainDate('2026-03-09')).toBe('9 March 2026')
  })

  it('returns an unrecognised value unchanged rather than hiding it', () => {
    expect(formatPlainDate('sometime last year')).toBe('sometime last year')
  })
})
