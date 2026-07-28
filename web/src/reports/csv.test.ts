import { describe, expect, it } from 'vitest'
import { csvField, toCsv } from './csv'

describe('csvField', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvField('Manhattan')).toBe('Manhattan')
    expect(csvField(1736)).toBe('1736')
  })

  it('quotes a value containing the delimiter', () => {
    expect(csvField('Coffee/Tea, hot')).toBe('"Coffee/Tea, hot"')
  })

  // Doubling the quote is how CSV escapes one; there is no backslash escape in the format.
  it('doubles an embedded quote', () => {
    expect(csvField('BOB"S DINER')).toBe('"BOB""S DINER"')
  })

  it('quotes a value containing a newline', () => {
    expect(csvField('two\nlines')).toBe('"two\nlines"')
  })

  /**
   * Not a CSV concern — an Excel one, and the reason this function exists rather than a join.
   *
   * A field beginning with `=`, `+`, `-` or `@` is treated as a formula when the file is opened. That
   * corrupts data (a cuisine literally named `-` becomes an error cell) and is the mechanism of CSV
   * injection, where an exported string becomes executable in somebody else's spreadsheet. Nothing in
   * this dataset currently starts with one; an export carries source data into a program that
   * executes some of it, and "the current data happens to be safe" does not survive the next
   * ingestion run.
   */
  it('neutralises a value Excel would run as a formula', () => {
    expect(csvField('=1+1')).toBe('\t=1+1')
    expect(csvField('+44 20')).toBe('\t+44 20')
    expect(csvField('-5')).toBe('\t-5')
    expect(csvField('@import')).toBe('\t@import')
  })

  it('quotes a guarded value that also needs quoting', () => {
    expect(csvField('=SUM(A1,A2)')).toBe('"\t=SUM(A1,A2)"')
  })

  // A number that happens to be negative is data, not a formula, and must survive as a number.
  it('does not mangle a negative number into text Excel cannot add up', () => {
    expect(csvField(-5)).toBe('\t-5')
  })
})

describe('toCsv', () => {
  const document = {
    provenance: ['Freshline — outcomes by borough', 'Filters: none'],
    header: ['Borough', 'Total'],
    rows: [
      ['Queens', 5303],
      ['Manhattan', 9239],
    ],
  }

  it('writes provenance above the table as comments', () => {
    const csv = toCsv(document)

    expect(csv.startsWith('# Freshline — outcomes by borough\r\n# Filters: none\r\n')).toBe(true)
  })

  /**
   * RFC 4180 names CRLF, and this is a format whose only purpose is being opened by other people's
   * software. Bare newlines work in most tools and misbehave in some.
   */
  it('uses CRLF line endings and ends with one', () => {
    const csv = toCsv(document)

    expect(csv).toContain('Borough,Total\r\n')
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv).not.toMatch(/[^\r]\n/)
  })

  it('writes every row', () => {
    const csv = toCsv(document)

    expect(csv).toContain('Queens,5303\r\n')
    expect(csv).toContain('Manhattan,9239\r\n')
  })
})
