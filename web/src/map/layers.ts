/**
 * The MapLibre paint expressions, generated from `pinStyle.ts` rather than written beside it.
 *
 * The alternative — a hand-written `['match', ['get', 'state'], 'Good', '#2a78d6', …]` in the layer
 * and a separate legend listing the same hexes — is two lists that agree today. Generating both from
 * one table means a colour cannot be changed in one place only.
 */

import { pinStates, pinStyles } from './pinStyle'

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

/**
 * How much bigger a point gets for holding several establishments.
 *
 * **Area, not radius, carries the meaning.** A dot twice the radius is four times the ink, so
 * scaling the radius linearly with the count would make a point of ten look like a point of a
 * hundred. The stops below follow roughly the square root of the count, which is what makes the
 * *area* proportional — the same reason bubble charts are sized that way.
 *
 * Capped at 20. Beyond that the dot is competing with the street it sits on, and a point holding 49
 * establishments — one exists on Broadway — would otherwise draw a disc wide enough to swallow its
 * neighbours and hide exactly the pins somebody is looking for.
 *
 * `interpolate` on a data property is legal at any depth, unlike `['zoom']` — see the note below,
 * which is why this multiplies into the zoom stops rather than wrapping them.
 */
const countScale: Expression = [
  'interpolate',
  ['linear'],
  ['get', 'count'],
  1,
  1,
  4,
  1.5,
  10,
  1.9,
  20,
  2.3,
]

/**
 * Grown while the pointer is on it.
 *
 * `feature-state` rather than a property, so hovering changes nothing about the data — no source
 * rebuild, no re-tiling, and the whole effect is one value MapLibre already re-reads each frame.
 */
const hoverScale: Expression = ['case', ['boolean', ['feature-state', 'hover'], false], 1.35, 1]

const sizedRadius: Expression = ['*', stateRadius, countScale, hoverScale]

/**
 * How large a sphere sprite is drawn, as a multiple of its 64px source.
 *
 * `icon-size` rather than `circle-radius`: the pins are a symbol layer now, drawing the shaded
 * spheres in `sphereSprite.ts`. The arithmetic is otherwise the same one the circles used — a state
 * size, scaled by how many establishments share the point, grown while hovered, all interpolated
 * over zoom.
 *
 * Divided by half the sprite size, because the state sizes in `pinStyle.ts` are radii in pixels and
 * `icon-size` is a scale factor. Keeping the radii as the unit means the legend swatches and the map
 * still read from one table.
 */
const iconScale: Expression = ['/', sizedRadius, 32]

export const iconSize: Expression = [
  'interpolate',
  ['linear'],
  ['zoom'],
  12,
  ['*', 0.6, iconScale],
  16,
  iconScale,
  19,
  ['*', 1.8, iconScale],
]

/**
 * Which sphere to draw.
 *
 * Two images per state, because closure is a separate fact from the result and has to survive the
 * move to sprites. A circle layer expressed it as a different stroke colour; a sprite bakes its rim
 * in, so the closed variant is a second image whose silhouette darkens towards
 * `closedModifier.stroke` instead of the state's own.
 *
 * Twelve images rather than six. At 16 KB each that is under 200 KB held for the map's lifetime, and
 * none of it is recomputed as the map moves.
 */
export const iconImage: Expression = [
  'case',
  ['get', 'closed'],
  matchOnState((state) => sphereImageName(state, true)),
  matchOnState((state) => sphereImageName(state, false)),
]

/**
 * The image name for a state, so registration and the expression above cannot disagree about it.
 */
export function sphereImageName(state: (typeof pinStates)[number], closed: boolean): string {
  return closed ? `sphere-${state}-closed` : `sphere-${state}`
}

/**
 * The pins that must not be painted over: `Poor` is 0.4% of the data and the tier the product exists
 * to surface, and a closure is the most urgent thing the map can say.
 *
 * A layer draws its features in whatever order the source hands them over, so "on top" is not
 * something a single layer can promise. Two layers with complementary filters can.
 *
 * Still meaningful now that a point carries a weighted state rather than an arbitrary one: a point
 * whose dominant state is `Poor`, or where anything was closed, is drawn above its neighbours.
 */
export const priorityFilter: Expression = [
  'any',
  ['==', ['get', 'state'], 'Poor'],
  ['get', 'closed'],
]

export const ordinaryFilter: Expression = ['!', priorityFilter]
