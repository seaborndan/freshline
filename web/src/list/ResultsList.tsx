/**
 * The establishments in view, as text.
 *
 * **This is the map, for anyone who cannot use the map.** Pins are pixels on a WebGL canvas: they
 * take no focus, they are in no accessibility tree, and until this existed a keyboard user could
 * reach every filter and never reach a single restaurant. Nothing about a `<canvas>` can be made to
 * fix that, so the fix is not on the canvas.
 *
 * It is also the panel the milestone's first decision committed to: the side list is *the same data
 * as the pins*, held once and rendered twice, rather than a second query. So the two cannot disagree
 * — a row is present exactly when its dot is, and selecting either opens the same record.
 *
 * ## Two things it deliberately does not do
 *
 * **It does not fetch additional pages.** The viewport response has no cursor. Local pagination
 * exposes the loaded records in groups of 50 and resets whenever that response changes.
 *
 * **It does not render everything.** A viewport can hold a thousand establishments and re-renders on
 * every pan; a thousand rows of DOM per pan is work landing on the frames a gesture needs — the
 * lesson from the smoothness fix. It shows a bounded window and says what it is showing, which is
 * the honest version of the same thing.
 */

import { memo, useState } from 'react'
import type { MapEstablishment } from '../api/contract'
import { pinStateOf, pinStyles } from '../map/pinStyle'

/**
 * How many rows are rendered.
 *
 * Enough to scroll through and understand the area, few enough that a pan does not rebuild a
 * thousand DOM nodes. Local pages never claim to include records omitted by the API.
 */
export const visibleRowCount = 50

export interface ResultsListProps {
  establishments: readonly MapEstablishment[]
  isTruncated: boolean
  selectedId: number | null
  onSelect: (id: number) => void
}

function ResultsListContent({
  establishments,
  isTruncated,
  selectedId,
  onSelect,
}: ResultsListProps) {
  // Alphabetical within the loaded subset. The API prioritizes severity when truncating;
  // this local ordering cannot recover omitted establishments.
  const sorted = [...establishments].sort((left, right) => left.name.localeCompare(right.name))
  // A new viewport response resets pagination; pages only navigate the already-loaded subset.
  const [pagination, setPagination] = useState({ items: establishments, page: 0 })
  const page = pagination.items === establishments ? pagination.page : 0
  const shown = sorted.slice(page * visibleRowCount, (page + 1) * visibleRowCount)
  const pageCount = Math.ceil(sorted.length / visibleRowCount)

  return (
    <section className="results" aria-labelledby="results-heading">
      <h2 id="results-heading">Places in view</h2>

      {establishments.length === 0 ? (
        <p className="results-count">Nothing here.</p>
      ) : (
        <p className="results-count">
          {/* No total while truncated: which rows were dropped is arbitrary, so "50 of 1,000" would
              be counting an arbitrary subset and calling it the area. */}
          {isTruncated
            ? `Showing ${shown.length} of more than ${establishments.length.toLocaleString('en-GB')}. Zoom in to narrow it down.`
            : shown.length < establishments.length
              ? `Showing ${shown.length} of ${establishments.length.toLocaleString('en-GB')}. Zoom in or filter to narrow it down.`
              : `${shown.length.toLocaleString('en-GB')} in view.`}
        </p>
      )}

      {pageCount > 1 ? (
        <div className="results-pagination" aria-label="Loaded places pages">
          <button type="button" disabled={page === 0} onClick={() => setPagination({ items: establishments, page: page - 1 })}>Previous</button>
          <span role="status">Page {page + 1} of {pageCount}</span>
          <button type="button" disabled={page + 1 === pageCount} onClick={() => setPagination({ items: establishments, page: page + 1 })}>Next</button>
        </div>
      ) : null}

      <ul>
        {shown.map((establishment) => {
          const style = pinStyles[pinStateOf(establishment)]

          return (
            <li key={establishment.id}>
              <button
                type="button"
                onClick={() => onSelect(establishment.id)}
                // The one row a screen reader should be told is different, said in the accessibility
                // tree rather than only in the highlight.
                aria-current={establishment.id === selectedId ? 'true' : undefined}
                className={establishment.id === selectedId ? 'results-row-selected' : undefined}
              >
                <span
                  className="legend-swatch"
                  style={{ backgroundColor: style.fill, borderColor: style.stroke }}
                  aria-hidden="true"
                />
                <span className="results-name">{establishment.name}</span>
                {/* The state in words, because the swatch beside it is decoration to a screen reader
                    and colour alone to everyone else. */}
                <span className="results-state">{style.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Memoised for the same reason the filter panel is: it re-renders on every pan and every loading
 * flip, and up to fifty rows of that is work competing with a gesture.
 */
export const ResultsList = memo(ResultsListContent)
