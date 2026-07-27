/**
 * The legend, generated from the same table the layer paints from.
 *
 * **Static and complete rather than derived from what is on screen.** A legend built from the pins
 * currently in view would drop `Poor` at most viewports — it is 0.4% of the data — and would leave
 * `PendingReinspection` as an unexplained colour on the day one first appears. It would also change
 * while the user pans, at which point it has stopped being a key and become a readout.
 *
 * Every row carries a phrase as well as a label, because the two rows that matter most are the two
 * that a single word cannot separate: "Ungraded" and "Never inspected" are 42% of the map between
 * them and both look like missing data until they are explained.
 */

import { memo } from 'react'
import { closedModifier, pinStates, pinStyles } from './pinStyle'

function LegendContent() {
  return (
    <section className="legend" aria-labelledby="legend-heading">
      <h2 id="legend-heading">What the colours mean</h2>

      <ul>
        {pinStates.map((state) => {
          const style = pinStyles[state]

          return (
            <li key={state}>
              <span
                className="legend-swatch"
                style={{ backgroundColor: style.fill, borderColor: style.stroke }}
                // The label beside it says the same thing in words, so announcing the swatch would
                // only repeat it. Identity is never carried by the colour alone.
                aria-hidden="true"
              />
              <span className="legend-label">{style.label}</span>
              <span className="legend-description">{style.description}</span>
            </li>
          )
        })}

        <li>
          <span
            className="legend-swatch legend-swatch-closed"
            style={{ borderColor: closedModifier.stroke }}
            aria-hidden="true"
          />
          <span className="legend-label">{closedModifier.label}</span>
          <span className="legend-description">{closedModifier.description}</span>
        </li>
      </ul>
    </section>
  )
}

/**
 * Memoised because it takes no props and never changes, while its parent re-renders on every pan and
 * every loading flip. Seven rows is not expensive, but it is work landing on the same frames a
 * gesture needs, and the cheapest work is the kind that does not happen.
 */
export const Legend = memo(LegendContent)
