/**
 * What every pin looks like, and what the legend says about it. One table, used by both — a legend
 * that is written separately from the layer is a legend that will eventually describe a colour the
 * map no longer draws.
 *
 * **Six states, not five.** The five outcomes plus never-inspected, which is not an outcome and is
 * the third-largest group on the map: 3,605 establishments, 3,399 of them drawable. Closure is a
 * seventh thing and deliberately not in this table — see `closedModifier`.
 *
 * ## Why the good end is blue rather than green
 *
 * Green-amber-red is the obvious scale for hygiene and it was the first thing tried. It was measured
 * and rejected: status green `#0ca30c` against status red `#d03b3b` is **ΔE 4.1 under deuteranopia**,
 * which is the most common colour-vision deficiency — so the two colours carrying "best restaurant
 * here" and "worst restaurant here" are the pair a substantial share of men cannot separate. On a map
 * where colour is the entire message, that is not a cosmetic problem.
 *
 * The scale below measures **ΔE 9.1 at its worst pair under deuteranopia and 16.3 under normal
 * vision**, across all pairs rather than adjacent ones, because any two pins can end up next to each
 * other on a map. Red still means bad; blue rather than green means good, and the legend is always on
 * screen to say so.
 *
 * Severity is also encoded by **size**, so colour is never the only channel: worse is bigger. That
 * doubles as the fix for `Poor` being 93 establishments — 0.4% of the data, and the tier the product
 * exists to surface.
 *
 * Validated with the dataviz palette validator against the Positron basemap surface. Two of its
 * checks are deliberately not met and both are recorded here rather than worked around:
 * `#898781` fails the chroma floor because it "reads gray", which is the intended meaning of "no
 * grade was published"; and `#eda100` sits below 3:1 contrast, which its own palette documents as
 * by-design for the warning step and mitigates with a visible label — which the legend is.
 */

import type { InspectionOutcome, MapEstablishment } from '../api/contract'

/** The five outcomes plus the one state that is not an outcome. */
export type PinState = InspectionOutcome | 'NeverInspected'

export interface PinStyle {
  state: PinState

  /** The legend's heading for this state. */
  label: string

  /**
   * The phrase after the label. Required, not optional: "Ungraded" and "Never inspected" are 42% of
   * the map between them, and neither word distinguishes itself from the other — or from missing
   * data — without a sentence.
   */
  description: string

  /** Circle fill. */
  fill: string

  /**
   * Circle outline. White on the filled states, because pins overlap heavily at this density and a
   * surface-coloured ring is what keeps two adjacent dots from reading as one blob.
   */
  stroke: string

  /** Relative size. Ordered by severity so colour is not the only channel carrying it. */
  radius: number
}

/**
 * Legend order, which is human order rather than enum order: the scale, then the process state, then
 * the two absences. `InspectionOutcome` starts at `Ungraded = 0` for reasons that belong to the
 * database, not to a reader.
 */
export const pinStates: readonly PinState[] = [
  'Good',
  'Fair',
  'Poor',
  'PendingReinspection',
  'Ungraded',
  'NeverInspected',
]

export const pinStyles: Record<PinState, PinStyle> = {
  Good: {
    state: 'Good',
    label: 'Good',
    description: 'Passed its most recent inspection — NYC grade A',
    fill: '#2a78d6',
    stroke: '#ffffff',
    radius: 4,
  },
  Fair: {
    state: 'Fair',
    label: 'Fair',
    description: 'Middling result at its most recent inspection — NYC grade B',
    fill: '#eda100',
    stroke: '#ffffff',
    radius: 5,
  },
  Poor: {
    state: 'Poor',
    label: 'Poor',
    description: 'Worst published result — NYC grade C',
    fill: '#d03b3b',
    stroke: '#ffffff',
    radius: 6.5,
  },
  PendingReinspection: {
    state: 'PendingReinspection',
    label: 'Awaiting re-inspection',
    // Off the good-to-poor scale on purpose, and coloured off it too: this is a regulatory state
    // rather than a grade. No establishment on the map is in it today — 108 inspections carry it
    // historically and it is the latest outcome for none — so it cannot be checked by looking.
    description: 'Graded P — a re-inspection is due, usually after a closure',
    fill: '#4a3aa7',
    stroke: '#ffffff',
    radius: 5,
  },
  Ungraded: {
    state: 'Ungraded',
    label: 'Ungraded',
    description: 'Inspected, but no grade was published',
    fill: '#898781',
    stroke: '#ffffff',
    radius: 4,
  },
  NeverInspected: {
    state: 'NeverInspected',
    label: 'Never inspected',
    // Hollow rather than a sixth hue. "Nothing has been assessed" is better said by an empty pin
    // than by another colour, and it separates this from Ungraded by shape as well as by fill —
    // the two are neighbours in meaning and the two largest non-grades on the map.
    description: 'Holds a permit and has no inspection on record',
    fill: '#ffffff',
    stroke: '#898781',
    radius: 4,
  },
}

/**
 * Closure is a modifier, not a seventh colour.
 *
 * An establishment can be closed at any grade — 62 of them are, and the one in the fixtures is
 * `Ungraded` with no letter grade at all. Giving it a colour would put it on a scale it is not on and
 * would silently overwrite the grade it does have.
 */
export const closedModifier = {
  label: 'Closed by the authority',
  description: 'Ordered shut at its most recent inspection. Can happen at any grade',
  stroke: '#0b0b0b',
  strokeWidth: 2.5,
} as const

/**
 * Which state a pin is in.
 *
 * Reads `latestInspection === null` rather than `isAwaitingFirstInspection`; the two are equivalent
 * and the validator has already refused the response if they disagreed. This way round because the
 * field being read is the one whose absence forces the branch.
 */
export function pinStateOf(establishment: MapEstablishment): PinState {
  return establishment.latestInspection === null
    ? 'NeverInspected'
    : establishment.latestInspection.outcome
}

/** True when this pin needs the closure ring. */
export function isClosed(establishment: MapEstablishment): boolean {
  return establishment.latestInspection?.closedByAuthority === true
}

/**
 * How much each state weighs when several establishments share one coordinate.
 *
 * ## Why a weight and not a rank
 *
 * Stacked establishments used to be separate features drawn exactly on top of each other, so the
 * visible colour was whichever the source handed over last — arbitrary, and different between two
 * runs of the same query. Drawing one dot per point means choosing, and the first version of that
 * choice was a strict ranking: the single most severe state always won.
 *
 * A ranking cannot express "how much of this is here". One `Poor` among forty-eight and forty-eight
 * `Poor` among forty-eight produced the same dot, and the second is a materially worse place to
 * stand. Weights let the count matter without letting it bury a warning.
 *
 * ## How the numbers are chosen
 *
 * A point shows the state with the **highest total weight**, where total weight is the state's weight
 * multiplied by how many establishments at that point have it. The scale is deliberately steep, and
 * the steepness is doing specific work — the busiest point in the city holds **49** establishments,
 * so every gap below is sized against that number rather than chosen to look tidy:
 *
 * - **`Poor` and `PendingReinspection` are weighted the most**, far beyond anything a count can
 *   overcome. A failed inspection and one awaiting re-inspection are the two states the product
 *   exists to surface, and no quantity of good news should bury one. 49 `Good` totals 490 against a
 *   single `Poor` at 100,000.
 * - `Fair` at 1,000 sits above any realistic stack of `Good` (49 × 10 = 490), so one middling result
 *   among a crowd of good ones still shows. It is far below `Poor`, so 49 `Fair` never outranks one
 *   `Poor`.
 * - `Good` at 10 sits above the two states that are not a result at all, so **one good establishment
 *   among a handful of ungraded ones shows as good** — but 49 ungraded against 1 good does not,
 *   because at that point the honest description of the address is "mostly ungraded".
 *
 * That last line is where a plain ranking could not go. It is the whole reason these are weights.
 *
 * `PendingReinspection` is **0 rows in the live data** — the city has published none. It is weighted
 * on what it means rather than on what it currently costs, so the day one appears the map already
 * treats it correctly.
 *
 * ## What a dot still cannot say
 *
 * It reports one state, and a point can hold eighteen establishments in five of them. The size says
 * how many are there and the chooser lists them; the colour answers "what is the most important
 * thing here", which is the question somebody scanning a map is asking.
 */
export const pinWeight: Record<PinState, number> = {
  Poor: 100_000,
  PendingReinspection: 90_000,
  Fair: 1_000,
  Good: 10,
  Ungraded: 3,
  NeverInspected: 2,
}

/**
 * The state a point shows, given everything stacked on it.
 *
 * Ties break towards the heavier state — `pinStates` is not ordered by weight, so the comparison is
 * on the weight itself rather than on position. Without that, a point with equal totals would show
 * whichever state happened to come first in the input, which is the arbitrariness this replaced.
 */
export function dominantState(states: readonly PinState[]): PinState {
  const totals = new Map<PinState, number>()

  for (const state of states) {
    totals.set(state, (totals.get(state) ?? 0) + pinWeight[state])
  }

  let dominant = states[0]
  let best = -1

  for (const [state, total] of totals) {
    if (total > best || (total === best && pinWeight[state] > pinWeight[dominant])) {
      dominant = state
      best = total
    }
  }

  return dominant
}
