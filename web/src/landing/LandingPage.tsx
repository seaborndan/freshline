/**
 * The front door.
 *
 * ## What this page is for
 *
 * Before this existed the application *was* the map: a stranger arrived inside a tool with no idea
 * what it was, whose data it showed, or how current any of it was. This page answers those three
 * questions and then gets out of the way.
 *
 * ## The rules it follows
 *
 * **Every number here is fetched, never typed.** A figure written into this file would be true the
 * day it was written and silently false after the next ingestion run — the slow version of inventing
 * a number, which `CLAUDE.md` forbids outright.
 *
 * **Counts, not conclusions.** No "average grade", no "safest borough". Those are claims, and a
 * claim drawn over a whole city buries the small-sample problem that makes per-cuisine and
 * per-borough figures misleading. Rankings belong in the reports, where the sample size can be shown
 * beside them.
 *
 * **The never-inspected count is given the same prominence as the totals.** It is the most
 * frequently misread thing in this dataset: a reader who assumes every establishment carries a grade
 * misreads every other number on the page.
 */

import type { DatasetSummary } from '../api/contract'
import { formatPlainDate } from '../api/plainDate'
import type { Route } from '../routing/route'
import { pathFromRoute } from '../routing/route'
import { useDatasetSummary } from './useDatasetSummary'

export interface LandingPageProps {
  onNavigate: (route: Route) => void
}

export function LandingPage({ onNavigate }: LandingPageProps) {
  const { summary, isLoading, failure } = useDatasetSummary()

  return (
    <div className="landing">
      <section className="landing-hero">
        <h1>New York City restaurant inspections, made legible.</h1>

        <p className="landing-lede">
          Every restaurant the city inspects, on a map and in a table. Freshline takes the New York
          City Department of Health and Mental Hygiene&rsquo;s published inspection record,
          normalises it into one shape, and lets you look at it by area, cuisine, and result.
        </p>

        <div className="landing-actions">
          <PrimaryLink route="map" onNavigate={onNavigate}>
            Open the map
          </PrimaryLink>
          <PrimaryLink route="reports" onNavigate={onNavigate}>
            Browse reports
          </PrimaryLink>
        </div>
      </section>

      <Numbers summary={summary} isLoading={isLoading} failure={failure} />

      <section className="landing-explain">
        <h2>What you are looking at</h2>

        <dl>
          <dt>Inspections produce a letter, and a letter is not the whole story.</dt>
          <dd>
            The city issues six different grade values, and an inspection can end without a letter at
            all &mdash; pending a re-inspection, or ungraded. Freshline collapses those into five
            outcomes so that a colour on the map means one thing, and shows the original letter on
            the establishment&rsquo;s record so nothing is hidden behind the simplification.
          </dd>

          <dt>Not being inspected is a state, not missing data.</dt>
          <dd>
            {summary === null
              ? 'Some establishments hold a permit and have never been visited.'
              : `${summary.awaitingFirstInspectionCount.toLocaleString('en-GB')} establishments hold a permit and have never been visited.`}{' '}
            They are drawn in white on the map rather than left off it. Omitting them would make the
            city look more thoroughly inspected than it is.
          </dd>

          <dt>Closure is separate from the grade.</dt>
          <dd>
            The health department can close an establishment at an inspection that produced no letter
            grade. Freshline shows that as its own fact rather than folding it into the result.
          </dd>
        </dl>
      </section>

      <section className="landing-provenance">
        <h2>Where this comes from</h2>

        <p>
          Data is republished from{' '}
          <a
            href="https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j"
            target="_blank"
            rel="noreferrer noopener"
          >
            NYC Open Data
          </a>
          , which is the authoritative source. <strong>Freshline is not affiliated with the City of
          New York</strong>, is not an official record, and is not live &mdash; it is a copy that
          updates when its ingestion runs.
        </p>

        <p>
          If a result here matters to you, check it against the city&rsquo;s own record. This site
          exists to make the data browsable, not to replace it.
        </p>
      </section>
    </div>
  )
}

function PrimaryLink({
  route,
  onNavigate,
  children,
}: {
  route: Route
  onNavigate: (route: Route) => void
  children: React.ReactNode
}) {
  return (
    <a
      className="landing-action"
      href={pathFromRoute(route)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return
        }

        event.preventDefault()
        onNavigate(route)
      }}
    >
      {children}
    </a>
  )
}

/**
 * The headline figures.
 *
 * The whole block is withheld while loading and on failure, rather than rendered with dashes or
 * zeroes in it. A zero here is a factual claim — "there are no establishments" — and showing one as
 * a placeholder would be the page stating something false while it waits.
 */
function Numbers({
  summary,
  isLoading,
  failure,
}: {
  summary: DatasetSummary | null
  isLoading: boolean
  failure: string | null
}) {
  if (failure !== null) {
    return (
      <section className="landing-numbers">
        <p role="alert" className="landing-numbers-failure">
          The dataset summary could not be loaded, so the figures are not shown. {failure}
        </p>
      </section>
    )
  }

  if (summary === null) {
    return (
      <section className="landing-numbers">
        <p role="status">{isLoading ? 'Counting the dataset…' : ''}</p>
      </section>
    )
  }

  const format = (value: number) => value.toLocaleString('en-GB')

  return (
    <section className="landing-numbers" aria-label="What is in the dataset">
      <ul>
        <Figure value={format(summary.establishmentCount)} label="establishments" />
        <Figure value={format(summary.inspectionCount)} label="inspections" />
        <Figure
          value={format(summary.awaitingFirstInspectionCount)}
          label="never inspected"
          note="A published state, not missing data"
        />
        <Figure value={format(summary.localityCount)} label="boroughs" />
        <Figure value={format(summary.cuisineCount)} label="cuisine types" />
      </ul>

      <p className="landing-freshness">
        {summary.latestInspectionOn === null ? (
          'No inspections have been ingested yet.'
        ) : (
          <>
            Most recent inspection in the data:{' '}
            <strong>{formatPlainDate(summary.latestInspectionOn)}</strong>. That is the
            source&rsquo;s freshness rather than ours &mdash; an ingestion run that finds nothing new
            leaves it unchanged.
          </>
        )}
      </p>
    </section>
  )
}

function Figure({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <li>
      <span className="landing-figure">{value}</span>
      <span className="landing-figure-label">{label}</span>
      {note === undefined ? null : <span className="landing-figure-note">{note}</span>}
    </li>
  )
}
