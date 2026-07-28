/**
 * The API's response shapes, hand-written.
 *
 * Generating these from `/openapi/v1.json` was considered and turned down — see the dependency
 * section of `docs/milestones/m5-map-ui.md`. The short version: this is four response shapes and
 * about twenty fields, the generated file would describe endpoints this UI never calls, and codegen
 * run by hand drifts the first time nobody runs it. What replaces it is `validate.ts`, which checks
 * the shape at runtime — something these types cannot do, because they are erased before the first
 * response arrives.
 *
 * Read from the endpoint source and from captured responses (`__fixtures__/`), not recalled.
 */

/**
 * The normalised outcome scale. Five values, and the wire carries the **name** — `"Good"`, never
 * `1` — because the API serialises enums with `JsonStringEnumConverter` precisely so that reordering
 * the enum cannot silently change what a response means. Nothing here may switch on a number.
 *
 * `PendingReinspection` is reachable and appears on no pin today: 108 inspections carry it
 * historically and it is the latest outcome for zero establishments (measured 2026-07-26). It is
 * handled rather than expected.
 *
 * An array rather than a union alone, because the validator needs the values at runtime.
 */
export const inspectionOutcomes = [
  'Ungraded',
  'Good',
  'Fair',
  'Poor',
  'PendingReinspection',
] as const

export type InspectionOutcome = (typeof inspectionOutcomes)[number]

/**
 * A date with no time and no zone, as the wire spells it: `"2026-06-01"`.
 *
 * Typed as a plain string on purpose — this is the transport format. Everything that displays one
 * goes through `plainDate.ts`, because handing `"2026-06-01"` to `new Date()` yields UTC midnight,
 * which is the previous day everywhere west of Greenwich, including the city this data describes.
 */
export type PlainDateString = string

/** Just enough of the most recent inspection to colour a pin or fill a list row. */
export interface LatestInspectionSummary {
  inspectedOn: PlainDateString

  /**
   * The letter as published — `A B C N Z P` — or null, which is the case on a large share of
   * inspections and is not an error. Six values, not three.
   *
   * Recognisable to a user, and never used to colour anything: it is one city's vocabulary and there
   * are six of them against five outcomes.
   */
  rawGrade: string | null

  /** The scale everything is coloured and filtered by. */
  outcome: InspectionOutcome

  /** 0–100, **higher is worse**. Null when the source published no score. */
  normalisedSeverity: number | null

  /**
   * Orthogonal to `outcome`, not a sixth value of it. An establishment can be closed at any grade —
   * `POPEYES` in the fixtures is closed, `Ungraded`, and carries a severity of 75.
   */
  closedByAuthority: boolean
}

/** One pin. */
export interface MapEstablishment {
  id: number
  name: string

  /**
   * Never null here, unlike everywhere else in this API: the viewport query excludes establishments
   * without coordinates because they cannot be drawn — 511 of 23,528 on 2026-07-26.
   */
  latitude: number

  /** @see latitude */
  longitude: number

  /**
   * True when the establishment holds a permit and has never been inspected: 3,605 of them, the
   * third-largest group on the map. Equivalent to `latestInspection === null`, and the validator
   * enforces that rather than trusting it.
   */
  isAwaitingFirstInspection: boolean

  /**
   * Null when there has never been an inspection. **A different fact from `rawGrade: null`**, which
   * means inspected and ungraded. Collapsing the two mislabels 42% of the map.
   */
  latestInspection: LatestInspectionSummary | null
}

/** Everything inside the viewport, up to the requested limit. Not paged. */
export interface MapResult {
  items: MapEstablishment[]

  /**
   * True when the viewport holds more than the limit, so this is an arbitrary subset — primary-key
   * order, correlating with nothing a user cares about.
   *
   * The consequence the UI is bound by: while this is true, no count derived from `items` may be
   * displayed as a fact about the area. It is a banner and a suppression of numbers, not a
   * decoration.
   */
  isTruncated: boolean
}

/** A single cited violation. */
export interface ViolationDetail {
  /** The source's own code, e.g. `04L` for evidence of mice. This is the field to group on. */
  code: string

  description: string | null

  /**
   * Null is a genuine third state — the source published "Not Applicable" — rather than a missing
   * value. Flattening it to false would assert something the source never said.
   */
  isCritical: boolean | null
}

/** One visit, with everything cited during it. */
export interface InspectionDetail {
  id: number
  inspectedOn: PlainDateString
  inspectionType: string | null
  action: string | null
  rawGrade: string | null

  /** The score as published, un-clamped. Observed values run past 100. */
  rawScore: number | null

  outcome: InspectionOutcome
  normalisedSeverity: number | null
  closedByAuthority: boolean
  violations: ViolationDetail[]
}

/** One establishment with its history. At most 9 inspections, so nothing here needs virtualising. */
export interface EstablishmentDetail {
  id: number
  name: string
  cuisine: string | null
  phone: string | null
  addressLine: string | null

  /** The sub-city area — borough, in NYC. 66 establishments have none, and they match no filter. */
  locality: string | null

  postalCode: string | null

  /** Null together or present together, never one without the other. Nullable here, unlike a pin. */
  latitude: number | null

  /** @see latitude */
  longitude: number | null

  isAwaitingFirstInspection: boolean

  /** Newest first. Empty when the establishment has never been inspected. */
  inspections: InspectionDetail[]
}

/**
 * The values the cuisine and locality filters can actually match.
 *
 * A client cannot work these out for itself: a map pin does not carry a cuisine, and the list
 * endpoint returns one page's values rather than the vocabulary. Hard-coding them was the
 * alternative and was rejected — it puts one city's source vocabulary in a front end and drifts
 * silently the first time ingestion meets a new value.
 *
 * Nulls are absent because they are not selectable. That is not a corner case: cuisine is null for
 * exactly the establishments that have never been inspected — an exact correspondence in both
 * directions, 3,605 of them — so choosing any cuisine excludes every one of them.
 */
export interface EstablishmentFilterOptions {
  cuisines: string[]
  localities: string[]

  /**
   * Where each area's drawable establishments are, so choosing a borough can move the camera to it.
   *
   * Measured from the establishments rather than taken from a published borough outline — it frames
   * where the restaurants are, which is a different question from where the legal boundary runs, and
   * the more useful one for a camera.
   *
   * An area whose establishments all lack coordinates appears in `localities` and not here, so this
   * list can be shorter than that one. A lookup that misses is a borough with nowhere to point at,
   * not an error.
   */
  localityBounds: LocalityBounds[]
}

/** The box containing one area's drawable establishments. Named as `Viewport` names its edges. */
export interface LocalityBounds {
  locality: string
  minLatitude: number
  maxLatitude: number
  minLongitude: number
  maxLongitude: number
}

/**
 * The filters both the list and the map accept, spelled as the query string spells them.
 *
 * Undefined means "do not send this parameter". Note the trap for whoever builds the panel:
 * `outcome` matches against the latest inspection, so it excludes never-inspected establishments by
 * definition — combining it with `awaitingFirstInspection: true` is a guaranteed empty result rather
 * than a narrower one.
 */
export interface EstablishmentFilter {
  nameStartsWith?: string
  cuisine?: string
  locality?: string
  outcome?: InspectionOutcome
  awaitingFirstInspection?: boolean
}

/**
 * What the dataset contains, for the landing page.
 *
 * Counts rather than conclusions. No rates, no averages, no "worst borough" — every one of those is
 * a claim rather than a measurement, and a claim drawn over a whole city hides exactly the
 * small-sample effects that make per-cuisine figures misleading. This says what is in here.
 *
 * Fetched rather than hard-coded, because a figure typed into a page is true on the day it is
 * written and silently false after the next ingestion run.
 */
export interface DatasetSummary {
  establishmentCount: number

  /** A published state, not an absence in our records — 3,605 of 23,528 in the live data. */
  awaitingFirstInspectionCount: number

  inspectionCount: number
  localityCount: number
  cuisineCount: number

  /**
   * The most recent inspection date in the data, as `yyyy-mm-dd`, or null when there are none.
   *
   * **The source's freshness, not ours.** A successful ingestion run that found nothing new leaves
   * this unchanged, which is the honest thing to show: a figure based on our own job history would
   * report the data as current at the moment the city went quiet.
   */
  latestInspectionOn: string | null
}
