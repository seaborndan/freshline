/**
 * The MapLibre paint expressions, generated from `pinStyle.ts` rather than written beside it.
 *
 * The alternative — a hand-written `['match', ['get', 'state'], 'Good', '#2a78d6', …]` in the layer
 * and a separate legend listing the same hexes — is two lists that agree today. Generating both from
 * one table means a colour cannot be changed in one place only.
 */

import { closedModifier, pinSeverity, pinStates, pinStyles } from './pinStyle'

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

/**
 * How far apart, in screen pixels, two establishments can be and still share a dot.
 *
 * ## Why this is measured in pixels, and why that is the answer to "variable with zoom"
 *
 * A pixel radius is a *distance on screen*, so what it means on the ground changes with the camera
 * for free: at zoom 12 it covers a couple of streets, at zoom 18 it covers a shopfront. Zooming in
 * therefore breaks clusters apart and zooming out merges them, with no zoom-dependent logic to write
 * and nothing to recompute per frame — MapLibre rebuilds the index per zoom level once.
 *
 * ## Why 28
 *
 * The largest pin has a radius of 6.5 and grows to 1.8× at zoom 19, so two dots closer than about
 * 24 pixels overlap enough to hide one another. 28 is just past that: it merges the pairs that would
 * have obscured each other and leaves alone the ones that are legibly separate. Deliberately short of
 * MapLibre's default of 50, which is tuned for markers far larger than these and would swallow a
 * whole block.
 */
export const clusterRadius = 28

/**
 * The zoom above which nothing is clustered.
 *
 * 16 is roughly where a single block fills the screen. Past it a reader is looking at specific
 * buildings and wants the actual establishments, not a summary of them — and the dots are far enough
 * apart in screen terms that grouping would be inventing crowding that is not there.
 */
export const clusterMaxZoom = 16

/**
 * The size of a cluster, by how many establishments are under it.
 *
 * **Deliberately dramatic.** The complaint that produced this was that a point holding eighteen
 * establishments looked barely larger than one holding a single establishment — which was true, and
 * was because nothing scaled with the count at all: the only size difference on the map was between
 * states, 6.5 pixels for `Poor` against 4 for `Good`.
 *
 * The stops below take a dot from 7 to 26 pixels across that range, which is a factor of nearly four
 * in radius and fifteen in area. Steeper than the square-root scaling that makes area proportional to
 * count, and chosen over it on purpose: proportional area is the honest choice for a chart somebody
 * reads values from, and this is a map somebody scans. What the size has to do here is *catch an
 * eye*, and the exact number is one hover and one click away.
 *
 * Capped at 60. Above that the dot competes with the district it sits in, and the busiest cluster
 * in the city would otherwise cover its own neighbours — the thing a bigger dot must never do.
 */
const countRadius: Expression = [
  'interpolate',
  ['linear'],
  ['get', 'point_count'],
  2,
  7,
  5,
  11,
  12,
  16,
  30,
  21,
  60,
  26,
]

export const clusterCircleRadius: Expression = [
  'interpolate',
  ['linear'],
  ['zoom'],
  12,
  ['*', 0.6, countRadius],
  16,
  countRadius,
  19,
  ['*', 1.8, countRadius],
]

/**
 * A cluster's colour: the worst state under it.
 *
 * Keyed on the accumulated minimum severity rather than on a state name, because that is what a
 * clustering accumulator can produce. The fallback is the same deliberately-wrong magenta the
 * per-state expression uses — an unreachable branch should be obvious rather than plausible.
 */
export const clusterColour: Expression = [
  'match',
  ['get', 'severity'],
  ...pinStates.flatMap((state) => [pinSeverity[state], pinStyles[state].fill]),
  unreachableColour,
]

export const clusterStrokeColour: Expression = [
  'match',
  ['get', 'severity'],
  ...pinStates.flatMap((state) => [pinSeverity[state], pinStyles[state].stroke]),
  unreachableColour,
]

/** Clusters holding something failed are drawn above the rest, like individual pins are. */
export const clusterPriorityFilter: Expression = [
  'all',
  ['has', 'point_count'],
  ['==', ['get', 'severity'], pinSeverity.Poor],
]

export const clusterOrdinaryFilter: Expression = [
  'all',
  ['has', 'point_count'],
  ['!=', ['get', 'severity'], pinSeverity.Poor],
]

/** A point that stands alone at this zoom, drawn by the per-state expressions above. */
export const unclusteredFilter: Expression = ['!', ['has', 'point_count']]
