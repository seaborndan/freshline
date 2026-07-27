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
 * **It does not page.** The viewport response is not paged and has no cursor; it is the answer to
 * "what is on screen" and it changes the moment the user moves. Paging through a viewport that
 * stopped existing is not a thing to offer.
 *
 * **It does not render everything.** A viewport can hold a thousand establishments and re-renders on
 * every pan; a thousand rows of DOM per pan is work landing on the frames a gesture needs — the
 * lesson from the smoothness fix. It shows a bounded window and says what it is showing, which is
 * the honest version of the same thing.
 */

import { memo } from 'react'
import type { MapEstablishment } from '../api/contract'
import { pinStateOf, pinStyles } from '../map/pinStyle'

/**
 * How many rows are rendered.
 *
 * Enough to scroll through and understand the area, few enough that a pan does not rebuild a
 * thousand DOM nodes. Not a page size — there is no second page, only a narrower viewport or a
 * filter.
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
  // Sorted here rather than by the API: the map endpoint returns primary-key order, which its own
  // documentation calls arbitrary. Name order is what the list endpoint uses, so the two agree.
  const sorted = [...establishments].sort((left, right) => left.name.localeCompare(right.name))
  const shown = sorted.slice(0, visibleRowCount)

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
