/**
 * Turning a report into a file somebody opens in Excel.
 *
 * ## Why CSV rather than a real `.xlsx`
 *
 * "Export to Excel" almost always means CSV, and Excel opens it. A genuine `.xlsx` needs a library —
 * ClosedXML or EPPlus — and a dependency is a decision under `CLAUDE.md`, not an implementation
 * detail. What it would buy is column widths, number formats and multiple sheets; none of those are
 * needed to hand somebody a table of numbers. If that changes, it changes as a written decision.
 *
 * ## Why the file carries its own provenance
 *
 * An exported table outlives the screen it came from. Somebody opens it a week later with no idea
 * which filters produced it, whether the data was current, or that the rows were ordered by
 * something other than the percentage column. A CSV that is only numbers is a set of numbers that
 * have escaped their context — which is exactly what this project's rules exist to prevent.
 *
 * So the file opens with comment lines naming the report, the filters, the row count and the date
 * the data covers. Excel shows them as ordinary rows; a human reads them, and nothing about the
 * table below is changed by their presence.
 */

/**
 * One CSV field, quoted when it has to be.
 *
 * **The leading-character check is not about CSV, it is about Excel.** A field beginning with `=`,
 * `+`, `-` or `@` is interpreted as a formula on open, which is both a corruption of the data —
 * a cuisine literally called `-` would vanish into an error cell — and the mechanism of CSV injection,
 * where an exported string becomes an executable formula in someone else's spreadsheet. Prefixing a
 * tab neutralises it while displaying identically.
 *
 * Nothing in this dataset currently starts with one of those characters. It is here because an export
 * carries source data into a program that executes some of it, and "the current data happens to be
 * safe" is not a property that survives the next ingestion run.
 */
export function csvField(value: string | number): string {
  const text = String(value)

  const needsFormulaGuard = /^[=+\-@\t\r]/.test(text)
  const guarded = needsFormulaGuard ? `\t${text}` : text

  // Quote when the field contains a delimiter, a quote, or a newline. Doubling the quote is how CSV
  // escapes one — there is no backslash escape in the format.
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }

  return guarded
}

export interface CsvDocument {
  /** Comment lines written above the table, without the leading `#`. */
  provenance: string[]
  header: string[]
  rows: (string | number)[][]
}

/**
 * The whole file as a string.
 *
 * CRLF line endings, because that is what Excel expects and what the CSV specification (RFC 4180)
 * names. A file with bare newlines opens correctly in most tools and misbehaves in some, and this is
 * a format whose only job is being opened by other people's software.
 */
export function toCsv(document: CsvDocument): string {
  const lines: string[] = [
    ...document.provenance.map((line) => `# ${line}`),
    document.header.map(csvField).join(','),
    ...document.rows.map((row) => row.map(csvField).join(',')),
  ]

  return `${lines.join('\r\n')}\r\n`
}

/**
 * Hands the file to the browser.
 *
 * A blob and a synthetic click, which is the only way to name a downloaded file from a page. The
 * object URL is revoked afterwards: without it the blob is held for the lifetime of the document,
 * and a user exporting repeatedly leaks every previous version.
 *
 * **The BOM is deliberate.** Excel on Windows reads a CSV without one using the system code page, so
 * `Café` arrives as `CafÃ©` — and this dataset has 9,963 rows containing a typographic apostrophe.
 * The three bytes make Excel read UTF-8, and every other tool ignores them.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()

  URL.revokeObjectURL(url)
}
