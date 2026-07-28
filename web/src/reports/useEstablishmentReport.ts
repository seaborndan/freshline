/**
 * Fetching the row-level report.
 *
 * Same shape as `useOutcomeBreakdown` and deliberately not shared with it: they return different
 * types, and a generic hook over both would take a fetcher and a result type as parameters to save
 * about fifteen lines. The duplication is legible; the abstraction would not be.
 */

import { useEffect, useState } from 'react'
import { fetchEstablishmentReport } from '../api/client'
import type { EstablishmentReport, EstablishmentReportRequest } from '../api/contract'
import { ApiProblemError, isAbortError } from '../api/errors'

export interface EstablishmentReportView {
  report: EstablishmentReport | null
  isLoading: boolean
  failure: string | null
  retryAfterSeconds: number | null
}

export function useEstablishmentReport(
  request: EstablishmentReportRequest,
): EstablishmentReportView {
  const [view, setView] = useState<EstablishmentReportView>({
    report: null,
    isLoading: true,
    failure: null,
    retryAfterSeconds: null,
  })

  // Serialised, so the effect re-runs on a change of contents rather than of object identity — the
  // caller builds a fresh object each render, and an object dependency would refetch forever.
  const key = JSON.stringify(request)

  useEffect(() => {
    const controller = new AbortController()
    const parsed = JSON.parse(key) as EstablishmentReportRequest

    setView((previous) => ({ ...previous, isLoading: true }))

    fetchEstablishmentReport(parsed, controller.signal)
      .then((report) =>
        setView({ report, isLoading: false, failure: null, retryAfterSeconds: null }),
      )
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return
        }

        setView({
          report: null,
          isLoading: false,
          failure: error instanceof Error ? error.message : 'The report could not be loaded.',
          retryAfterSeconds: error instanceof ApiProblemError ? error.retryAfterSeconds : null,
        })
      })

    return () => controller.abort()
  }, [key])

  return view
}
