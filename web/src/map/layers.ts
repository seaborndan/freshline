/**
 * The MapLibre paint expressions, generated from `pinStyle.ts` rather than written beside it.
 *
 * The alternative — a hand-written `['match', ['get', 'state'], 'Good', '#2a78d6', …]` in the layer
 * and a separate legend listing the same hexes — is two lists that agree today. Generating both from
 * one table means a colour cannot be changed in one place only.
 */

import { closedModifier, pinStates, pinStyles } from './pinStyle'

/** MapLibre expressions are nested JSON arrays; this is as much type as they need here. */
type Expression = unknown[]

/**
 * `match` requires a fallback, and this one is unreachable: `api/validate.ts` refuses any response
 * carrying a state not in the table above, so nothing can arrive here unmatched.
 *
 * Magenta on purpose. An unreachable branch should be obvious rather than plausible — if this ever
 * appears on screen it is a bug, and a pin that quietly borrowed the grey of "no grade published"
 * would be a wrong statement about a real restaurant instead.
 */
const unreachableColour = '#ff00ff'

function matchOnState(valueFor: (state: (typeof pinStates)[number]) => unknown): Expression {
  return [
    'match',
    ['get', 'state'],
    ...pinStates.flatMap((state) => [state, valueFor(state)]),
    unreachableColour,
  ]
}

export const circleColour: Expression = matchOnState((state) => pinStyles[state].fill)

/**
 * The closure ring wins over the ordinary outline, because it is the more urgent fact and there is
 * only one outline to give it.
 */
export const circleStrokeColour: Expression = [
  'case',
  ['get', 'closed'],
  closedModifier.stroke,
  matchOnState((state) => pinStyles[state].stroke),
]

export const circleStrokeWidth: Expression = [
  'case',
  ['get', 'closed'],
  closedModifier.strokeWidth,
  1,
]

/**
 * Radius is severity scaled by zoom, and the nesting order is not a matter of taste.
 *
 * `interpolate` has to be the **outermost** expression. MapLibre rejects a style where `['zoom']`
 * appears anywhere below the top level of a paint property — the natural-looking
 * `['*', interpolateOnZoom, matchOnState]` throws
 * *"zoom expression may only be used as input to a top-level step or interpolate expression"*,
 * the whole layer fails to be added, and the map renders a basemap with no pins on it while
 * everything else on the page behaves. Found by looking at the running app, not by a test.
 *
 * So the multiplication moves inside each stop: zoom on the outside, the per-state size on the
 * inside, which says the same thing and is a legal style.
 */
const stateRadius: Expression = [
  'match',
  ['get', 'state'],
  ...pinStates.flatMap((state) => [state, pinStyles[state].radius]),
  4,
]

export const circleRadius: Expression = [
  'interpolate',
  ['linear'],
  ['zoom'],
  12,
  ['*', 0.6, stateRadius],
  16,
  stateRadius,
  19,
  ['*', 1.8, stateRadius],
]

/**
 * The pins that must not be painted over: `Poor` is 0.4% of the data and the tier the product exists
 * to surface, and a closure is the most urgent thing the map can say.
 *
 * A circle layer draws its features in whatever order the source hands them over, so "on top" is not
 * something a single layer can promise. Two layers with complementary filters can.
 */
export const priorityFilter: Expression = [
  'any',
  ['==', ['get', 'state'], 'Poor'],
  ['get', 'closed'],
]

export const ordinaryFilter: Expression = ['!', priorityFilter]
