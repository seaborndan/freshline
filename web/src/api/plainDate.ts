/**
 * Reading and displaying the API's dates without going through `Date`.
 *
 * **The bug this file exists to prevent.** `inspectedOn` is a calendar date — `"2026-06-01"`, no
 * time, no zone. `new Date('2026-06-01')` parses it as UTC midnight, which is 8pm on 31 May in New
 * York, so `toLocaleDateString()` renders the day before the inspection happened. It is silent, it
 * is off by exactly one day, and it is wrong for every user west of Greenwich — which is all of them
 * for a New York dataset. There is no formatting option that fixes it, because by then the
 * information is already gone.
 *
 * So nothing here constructs a `Date`. The string is three numbers; it is read as three numbers and
 * printed as three numbers.
 */

export interface PlainDate {
  year: number
  /** 1–12, not the 0–11 that `Date` uses. */
  month: number
  day: number
}

const plainDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * The date, or null when the string is not one. Null rather than a throw because the caller —
 * `validate.ts` — is already in the business of reporting where a body went wrong, and has better
 * words for it than this function does.
 *
 * Range-checks the parts. `"2026-13-45"` matches the pattern and is not a date, and the display path
 * would otherwise print "45 undefined 2026".
 */
export function parsePlainDate(value: string): PlainDate | null {
  const match = plainDatePattern.exec(value)

  if (match === null) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    return null
  }

  return { year, month, day }
}

/**
 * For display: `"2026-06-01"` becomes `"1 June 2026"`.
 *
 * Day-month-year and a spelled month, because `01/06/2026` is the first of June to half the world
 * and the sixth of January to the other half, and a date on this map has no context to disambiguate
 * it. Spelling the month is the only format that cannot be misread.
 *
 * An unparseable value is returned unchanged rather than replaced with a placeholder — it came from
 * the API, and showing it is more honest than hiding it behind "Unknown".
 */
export function formatPlainDate(value: string): string {
  const date = parsePlainDate(value)

  if (date === null) {
    return value
  }

  return `${date.day} ${monthNames[date.month - 1]} ${date.year}`
}
