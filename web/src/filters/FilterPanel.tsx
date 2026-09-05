/**
 * The filter panel.
 *
 * It holds **no state of its own**. Every value is read from the props and every change is announced
 * upward, because the URL is the single source of truth — a panel with its own `useState` mirrored
 * into the address bar is two sources that disagree on the first shared link somebody opens.
 *
 * ## The combinations that can only return nothing
 *
 * Two of the four filters cannot be combined with "never inspected", and neither is obvious:
 *
 * - **`outcome` matches the latest inspection**, so an establishment with no inspections matches no
 *   outcome. This one is at least guessable from the words.
 * - **`cuisine` is null for exactly the never-inspected establishments** — verified as an exact
 *   correspondence in both directions against the live data, 3,605 rows, zero exceptions. NYC
 *   publishes no cuisine until somebody has been. Nothing in the words "cuisine" and "never
 *   inspected" suggests they are mutually exclusive, and choosing both returns zero results with no
 *   explanation.
 *
 * So when "never inspected" is on, those two controls are disabled and the panel says why. Disabled
 * rather than hidden: a control that vanishes leaves a user wondering what they did, while a
 * disabled one with a sentence beside it teaches them something true about the data.
 */

import { memo } from 'react'
import type { EstablishmentFilter, EstablishmentFilterOptions } from '../api/contract'
import { inspectionOutcomes } from '../api/contract'
import { pinStyles } from '../map/pinStyle'
import { hasAnyFilter } from './filterState'

export interface FilterPanelProps {
  filters: EstablishmentFilter
  options: EstablishmentFilterOptions | null
  onChange: (filters: EstablishmentFilter) => void
}

function FilterPanelContent({ filters, options, onChange }: FilterPanelProps) {
  const onlyNeverInspected = filters.awaitingFirstInspection === true

  // Undefined removes the key, which is what "no filter" means to the client — an empty string
  // would be sent as `?cuisine=`, an exact match against something nothing has.
  function change(patch: Partial<EstablishmentFilter>) {
    const next: EstablishmentFilter = { ...filters, ...patch }

    for (const key of Object.keys(next) as (keyof EstablishmentFilter)[]) {
      if (next[key] === undefined || next[key] === '') {
        delete next[key]
      }
    }

    onChange(next)
  }

  return (
    <section className="filters" aria-labelledby="filters-heading">
      <h2 id="filters-heading">Find your next place</h2>
      <p className="filter-intro">Explore by name, borough, or result.</p>

      <div className="filter-row">
        <label htmlFor="filter-name">Name starts with</label>
        <input
          id="filter-name"
          type="search"
          value={filters.nameStartsWith ?? ''}
          placeholder="e.g. DUNKIN"
          onChange={(event) => change({ nameStartsWith: event.target.value })}
        />
      </div>

      <div className="filter-row">
        <label htmlFor="filter-cuisine">Cuisine</label>
        <select
          id="filter-cuisine"
          value={filters.cuisine ?? ''}
          disabled={onlyNeverInspected || options === null}
          onChange={(event) => change({ cuisine: event.target.value })}
        >
          <option value="">Any</option>
          {(options?.cuisines ?? []).map((cuisine) => (
            <option key={cuisine} value={cuisine}>
              {cuisine}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-row">
        <label htmlFor="filter-locality">Borough</label>
        <select
          id="filter-locality"
          value={filters.locality ?? ''}
          disabled={options === null}
          onChange={(event) => change({ locality: event.target.value })}
        >
          <option value="">Any</option>
          {(options?.localities ?? []).map((locality) => (
            <option key={locality} value={locality}>
              {locality}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-row">
        <label htmlFor="filter-outcome">Latest result</label>
        <select
          id="filter-outcome"
          value={filters.outcome ?? ''}
          disabled={onlyNeverInspected}
          onChange={(event) => change({ outcome: event.target.value as EstablishmentFilter['outcome'] })}
        >
          <option value="">Any</option>
          {inspectionOutcomes.map((outcome) => (
            <option key={outcome} value={outcome}>
              {pinStyles[outcome].label}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-row filter-row-check">
        <input
          id="filter-uninspected"
          type="checkbox"
          checked={onlyNeverInspected}
          onChange={(event) =>
            change({ awaitingFirstInspection: event.target.checked ? true : undefined })
          }
        />
        <label htmlFor="filter-uninspected">Only places never inspected</label>
      </div>

      {onlyNeverInspected ? (
        <p className="filter-note">
          Cuisine and result are unavailable while this is on. A place that has never been inspected
          has no result, and the city publishes no cuisine for one either — so any combination would
          return nothing.
        </p>
      ) : null}

      {hasAnyFilter(filters) ? (
        <button type="button" onClick={() => onChange({})}>
          Clear filters
        </button>
      ) : null}
    </section>
  )
}

/**
 * Memoised because it renders a hundred and two `<option>` elements — the 89 cuisines especially —
 * and its parent re-renders on every pan and every loading flip. Its three props are all stable
 * between those renders: `filters` changes only when a filter changes, `options` is fetched once,
 * and `onChange` is a `useState` setter.
 */
export const FilterPanel = memo(FilterPanelContent)
