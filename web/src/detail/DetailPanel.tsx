/**
 * What one establishment's record looks like, and what a click on a crowded point does.
 *
 * ## Why a click can be ambiguous
 *
 * New York geocodes many establishments to the same address. In the opening view alone, 47 of 238
 * points carry more than one and the busiest carries 18; across the city one address carries 49.
 * They are drawn exactly on top of each other, so a click there is a question with several answers.
 *
 * Taking whichever feature MapLibre returns first would answer it arbitrarily — silently, and
 * differently depending on the order the source happened to tile. So a click that resolves to more
 * than one establishment **opens the list instead of an establishment**. One is a detail; several is
 * a choice, and the user makes it.
 *
 * Rejected: spreading the pins apart on click, which is a lot of machinery and moves restaurants to
 * places they are not; and a cluster count, which answers "how many" when the question is "which".
 */

import type { MapEstablishment } from '../api/contract'
import { formatPlainDate } from '../api/plainDate'
import { pinStateOf, pinStyles } from '../map/pinStyle'
import type { DetailView } from './useEstablishmentDetail'

export interface DetailPanelProps {
  /** Everything under the last click. Empty when nothing is selected. */
  candidates: MapEstablishment[]

  /** The chosen establishment's record, or the state of trying to get it. */
  view: DetailView

  /** Null while a stack is still being chosen from. */
  selectedId: number | null

  onSelect: (id: number) => void
  onClose: () => void
}

export function DetailPanel({ candidates, view, selectedId, onSelect, onClose }: DetailPanelProps) {
  // Gated on the selection as well as the candidates, not on the candidates alone. A link opened at
  // `?id=` names an establishment that is very often nowhere near the opening view — its pin is not
  // on screen and never was — and gating on candidates hid the panel entirely for exactly the case
  // the parameter exists to serve. Found by loading `?id=21`, which is in Staten Island.
  if (selectedId === null && candidates.length === 0) {
    return null
  }

  return (
    <section className="detail" aria-labelledby="detail-heading">
      <button type="button" className="detail-close" onClick={onClose} aria-label="Close">
        ×
      </button>

      {selectedId === null ? (
        <Chooser candidates={candidates} onSelect={onSelect} />
      ) : (
        <Detail view={view} />
      )}
    </section>
  )
}

/**
 * The list a crowded point resolves to.
 *
 * Each row carries the establishment's state as well as its name, because the whole reason someone
 * clicked a dot is that its colour said something — and at a stacked point the dot's colour is
 * whichever establishment happened to be drawn last, which is to say nobody's.
 */
function Chooser({
  candidates,
  onSelect,
}: {
  candidates: MapEstablishment[]
  onSelect: (id: number) => void
}) {
  return (
    <>
      <h2 id="detail-heading">{candidates.length} places at this address</h2>
      <p className="detail-note">
        They share the coordinates the city published, so they are drawn on the same spot.
      </p>

      <ul className="detail-choices">
        {candidates.map((candidate) => {
          const style = pinStyles[pinStateOf(candidate)]

          return (
            <li key={candidate.id}>
              <button type="button" onClick={() => onSelect(candidate.id)}>
                <span
                  className="legend-swatch"
                  style={{ backgroundColor: style.fill, borderColor: style.stroke }}
                  aria-hidden="true"
                />
                <span className="detail-choice-name">{candidate.name}</span>
                <span className="detail-choice-state">{style.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function Detail({ view }: { view: DetailView }) {
  const { detail, isLoading, failure } = view

  if (failure !== null) {
    return (
      <>
        <h2 id="detail-heading">Could not load this place</h2>
        <p role="alert">{failure}</p>
      </>
    )
  }

  if (detail === null) {
    return (
      <>
        <h2 id="detail-heading">Loading…</h2>
        {isLoading ? <p role="status">Fetching the inspection history.</p> : null}
      </>
    )
  }

  return (
    <>
      <h2 id="detail-heading">{detail.name}</h2>

      <p className="detail-address">
        {[detail.addressLine, detail.locality, detail.postalCode].filter(Boolean).join(', ')}
      </p>

      <dl className="detail-facts">
        {detail.cuisine === null ? null : (
          <>
            <dt>Cuisine</dt>
            <dd>{detail.cuisine}</dd>
          </>
        )}
        {detail.phone === null ? null : (
          <>
            <dt>Phone</dt>
            <dd>{detail.phone}</dd>
          </>
        )}
      </dl>

      <h3>Inspections</h3>

      {detail.isAwaitingFirstInspection ? (
        // A published fact, not an absence — the city lists this establishment and has not visited
        // it. Saying "no data" would describe our records rather than theirs.
        <p>
          This place holds a permit and has no inspection on record. That is a published state, not
          missing information.
        </p>
      ) : (
        <ol className="detail-inspections">
          {detail.inspections.map((inspection) => (
            <li key={inspection.id}>
              <p className="detail-inspection-head">
                {/* Formatted from the string, never through Date: "2026-06-01" parsed as a Date is
                    UTC midnight, which renders as the previous day in New York. */}
                <strong>{formatPlainDate(inspection.inspectedOn)}</strong>
                <span>{pinStyles[inspection.outcome].label}</span>
                {/* The letter is what a person recognises from the window. It is shown because it is
                    recognisable and never used to colour anything — six letters, five outcomes. */}
                {inspection.rawGrade === null ? null : <span>Grade {inspection.rawGrade}</span>}
                {inspection.rawScore === null ? null : <span>Score {inspection.rawScore}</span>}
              </p>

              {inspection.closedByAuthority ? (
                <p className="detail-closed">Closed by the authority at this inspection</p>
              ) : null}

              {inspection.violations.length === 0 ? (
                <p className="detail-none">No violations cited.</p>
              ) : (
                <ul className="detail-violations">
                  {inspection.violations.map((violation) => (
                    <li key={violation.code}>
                      <span className="detail-violation-code">{violation.code}</span>
                      <span>{violation.description ?? 'No description published.'}</span>
                      {/* Null is a third state — the source published "Not Applicable" — so only a
                          definite true is called critical. */}
                      {violation.isCritical === true ? (
                        <span className="detail-critical">Critical</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
