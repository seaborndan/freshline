/**
 * The boundary. Every response crosses it before any component sees it.
 *
 * This is what stands in place of generated types. TypeScript describes what the API is supposed to
 * send; by the time a response arrives the description has been erased and `response.json()` has
 * returned `any`, which type-checks against anything. An `outcome` of `"Excellent"` from a future
 * enum value, a pin whose coordinates were swapped, a `latestInspection` that disappeared — every
 * one of those compiles, renders, and is wrong on screen.
 *
 * **Failure is the whole response, not the offending row.** Dropping a bad pin and carrying on would
 * leave a map that is quietly missing places and a count that is quietly wrong, and a count that is
 * quietly wrong is the specific thing this milestone's rules forbid. It is the same stance the API
 * takes towards its own callers: invalid input is refused, not corrected.
 *
 * That stance is defensible because both sides of this contract live in one repository. Against a
 * third-party API it would be the wrong trade — there, a bad row is weather, and the client's job is
 * to survive it.
 */

import {
  inspectionOutcomes,
  reportDimensions,
  type DatasetSummary,
  type EstablishmentDetail,
  type EstablishmentFilterOptions,
  type InspectionDetail,
  type InspectionOutcome,
  type LocalityBounds,
  type OutcomeBreakdown,
  type OutcomeBreakdownRow,
  type EstablishmentReport,
  type EstablishmentReportRow,
  type ProportionEstimate,
  type ReportDimension,
  type LatestInspectionSummary,
  type MapEstablishment,
  type MapResult,
  type ViolationDetail,
} from './contract'
import { ApiContractError } from './errors'
import { parsePlainDate } from './plainDate'
import { containsPoint, type Viewport } from './viewport'

function fail(path: string, expectation: string): never {
  throw new ApiContractError(path, expectation)
}

/** What a value is, for an error message. `null` is worth naming separately from `object`. */
function describe(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value
}

function readObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, `expected an object, got ${describe(value)}`)
  }

  return value as Record<string, unknown>
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(path, `expected an array, got ${describe(value)}`)
  }

  return value
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    fail(path, `expected a string, got ${describe(value)}`)
  }

  return value
}

function readNullableString(value: unknown, path: string): string | null {
  return value === null ? null : readString(value, path)
}

/**
 * Finite, and therefore not `NaN` or `Infinity`. JSON cannot carry either, but a `null` coerced
 * somewhere upstream can arrive as one, and `NaN` compares false against every bound — it would pass
 * a range check written the obvious way.
 */
function readNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, `expected a finite number, got ${describe(value)}`)
  }

  return value
}

function readNullableNumber(value: unknown, path: string): number | null {
  return value === null ? null : readNumber(value, path)
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    fail(path, `expected a boolean, got ${describe(value)}`)
  }

  return value
}

function readNullableBoolean(value: unknown, path: string): boolean | null {
  return value === null ? null : readBoolean(value, path)
}

function readPlainDateString(value: unknown, path: string): string {
  const text = readString(value, path)

  if (parsePlainDate(text) === null) {
    fail(path, `expected a date as yyyy-mm-dd, got ${JSON.stringify(text)}`)
  }

  return text
}

/**
 * The check that generated types could not have made.
 *
 * A sixth outcome would be a new value on the server's enum — the one kind of API change the
 * project's "add optional fields, never remove or repurpose one" rule does not cover, and exactly
 * what a second city would cause. Every colour on this map, and the legend explaining them, is keyed
 * on this set. An unrecognised value has no colour and no legend entry, so it would draw as
 * whatever the fallback branch happens to be and silently claim something untrue about a restaurant.
 */
function readOutcome(value: unknown, path: string): InspectionOutcome {
  const text = readString(value, path)

  if (!(inspectionOutcomes as readonly string[]).includes(text)) {
    fail(
      path,
      `expected one of ${inspectionOutcomes.join(', ')}, got ${JSON.stringify(text)}. ` +
        'The API has an outcome this client does not know how to colour.',
    )
  }

  return text as InspectionOutcome
}

function readLatestInspection(value: unknown, path: string): LatestInspectionSummary | null {
  if (value === null) {
    return null
  }

  const source = readObject(value, path)

  return {
    inspectedOn: readPlainDateString(source.inspectedOn, `${path}.inspectedOn`),
    rawGrade: readNullableString(source.rawGrade, `${path}.rawGrade`),
    outcome: readOutcome(source.outcome, `${path}.outcome`),
    normalisedSeverity: readNullableNumber(source.normalisedSeverity, `${path}.normalisedSeverity`),
    closedByAuthority: readBoolean(source.closedByAuthority, `${path}.closedByAuthority`),
  }
}

function readMapEstablishment(
  value: unknown,
  path: string,
  requested: Viewport,
): MapEstablishment {
  const source = readObject(value, path)

  const latitude = readNumber(source.latitude, `${path}.latitude`)
  const longitude = readNumber(source.longitude, `${path}.longitude`)

  // The only automated defence against a swapped axis that actually works here.
  //
  // Range-checking will not do it: New York sits at roughly 40.7°N, -74.0°E, and both of those are
  // legal values for the other axis — a swap produces a perfectly valid-looking point in the Indian
  // Ocean off Somalia. What is not legal is being outside the rectangle that was asked for, and a
  // swap anywhere in this client's own query building puts every pin outside it at once.
  if (!containsPoint(requested, latitude, longitude)) {
    fail(
      path,
      `the pin at ${latitude}, ${longitude} is outside the requested viewport ` +
        `(${requested.minLatitude} to ${requested.maxLatitude} by ` +
        `${requested.minLongitude} to ${requested.maxLongitude}). ` +
        'The likeliest cause is latitude and longitude swapped somewhere in this client.',
    )
  }

  const isAwaitingFirstInspection = readBoolean(
    source.isAwaitingFirstInspection,
    `${path}.isAwaitingFirstInspection`,
  )
  const latestInspection = readLatestInspection(source.latestInspection, `${path}.latestInspection`)

  // Two ways of saying the same thing, and the UI has to render them as different states — never
  // inspected is a colour of its own, distinct from inspected-and-ungraded. If they ever disagree,
  // one of the two facts is wrong and there is no way to tell which; choosing quietly is exactly the
  // collapse the contract is shaped to prevent.
  //
  // Held on a sample rather than proven: 5,000 rows on 2026-07-26, zero disagreements.
  if (isAwaitingFirstInspection !== (latestInspection === null)) {
    fail(
      path,
      `isAwaitingFirstInspection is ${isAwaitingFirstInspection} but latestInspection is ` +
        `${latestInspection === null ? 'null' : 'present'}. These must agree.`,
    )
  }

  return {
    id: readNumber(source.id, `${path}.id`),
    name: readString(source.name, `${path}.name`),
    latitude,
    longitude,
    isAwaitingFirstInspection,
    latestInspection,
  }
}

/**
 * `GET /establishments/map`.
 *
 * Takes the viewport that was requested, because half of what makes this check worth having is
 * comparing the answer against the question.
 */
export function readMapResult(body: unknown, requested: Viewport): MapResult {
  const source = readObject(body, 'response')
  const items = readArray(source.items, 'items')

  return {
    items: items.map((item, index) => readMapEstablishment(item, `items[${index}]`, requested)),
    isTruncated: readBoolean(source.isTruncated, 'isTruncated'),
  }
}

function readViolation(value: unknown, path: string): ViolationDetail {
  const source = readObject(value, path)

  return {
    code: readString(source.code, `${path}.code`),
    description: readNullableString(source.description, `${path}.description`),
    isCritical: readNullableBoolean(source.isCritical, `${path}.isCritical`),
  }
}

function readInspection(value: unknown, path: string): InspectionDetail {
  const source = readObject(value, path)

  return {
    id: readNumber(source.id, `${path}.id`),
    inspectedOn: readPlainDateString(source.inspectedOn, `${path}.inspectedOn`),
    inspectionType: readNullableString(source.inspectionType, `${path}.inspectionType`),
    action: readNullableString(source.action, `${path}.action`),
    rawGrade: readNullableString(source.rawGrade, `${path}.rawGrade`),
    rawScore: readNullableNumber(source.rawScore, `${path}.rawScore`),
    outcome: readOutcome(source.outcome, `${path}.outcome`),
    normalisedSeverity: readNullableNumber(source.normalisedSeverity, `${path}.normalisedSeverity`),
    closedByAuthority: readBoolean(source.closedByAuthority, `${path}.closedByAuthority`),
    violations: readArray(source.violations, `${path}.violations`).map((violation, index) =>
      readViolation(violation, `${path}.violations[${index}]`),
    ),
  }
}

/**
 * `GET /establishments/{id}`.
 *
 * No viewport check here: this endpoint answers about one establishment wherever it is, its
 * coordinates are nullable, and 511 establishments have none at all. World bounds are the only claim
 * that can be made, and they are checked because a coordinate outside them is meaningless rather
 * than merely surprising.
 */
export function readEstablishmentDetail(body: unknown): EstablishmentDetail {
  const source = readObject(body, 'response')

  const latitude = readNullableNumber(source.latitude, 'latitude')
  const longitude = readNullableNumber(source.longitude, 'longitude')

  if (latitude !== null && (latitude < -90 || latitude > 90)) {
    fail('latitude', `expected between -90 and 90, got ${latitude}`)
  }

  if (longitude !== null && (longitude < -180 || longitude > 180)) {
    fail('longitude', `expected between -180 and 180, got ${longitude}`)
  }

  // Null together or present together — the contract says so, and a half-located establishment
  // cannot be drawn or described.
  if ((latitude === null) !== (longitude === null)) {
    fail('latitude', 'latitude and longitude must be null together or present together.')
  }

  const isAwaitingFirstInspection = readBoolean(
    source.isAwaitingFirstInspection,
    'isAwaitingFirstInspection',
  )
  const inspections = readArray(source.inspections, 'inspections').map((inspection, index) =>
    readInspection(inspection, `inspections[${index}]`),
  )

  if (isAwaitingFirstInspection !== (inspections.length === 0)) {
    fail(
      'isAwaitingFirstInspection',
      `is ${isAwaitingFirstInspection} but there are ${inspections.length} inspections. ` +
        'These must agree.',
    )
  }

  return {
    id: readNumber(source.id, 'id'),
    name: readString(source.name, 'name'),
    cuisine: readNullableString(source.cuisine, 'cuisine'),
    phone: readNullableString(source.phone, 'phone'),
    addressLine: readNullableString(source.addressLine, 'addressLine'),
    locality: readNullableString(source.locality, 'locality'),
    postalCode: readNullableString(source.postalCode, 'postalCode'),
    latitude,
    longitude,
    isAwaitingFirstInspection,
    inspections,
  }
}

/**
 * `GET /establishments/filter-options`.
 *
 * Every entry is checked to be a non-empty string, because an empty one would render as a blank row
 * in a dropdown that selects nothing — `?cuisine=` matches the empty string, which nothing has. The
 * endpoint excludes nulls at the database, and this is the assertion that it did.
 */
export function readFilterOptions(body: unknown): EstablishmentFilterOptions {
  const source = readObject(body, 'response')

  const readNames = (value: unknown, path: string): string[] =>
    readArray(value, path).map((entry, index) => {
      const name = readString(entry, `${path}[${index}]`)

      if (name === '') {
        fail(`${path}[${index}]`, 'expected a selectable value, got an empty string')
      }

      return name
    })

  return {
    cuisines: readNames(source.cuisines, 'cuisines'),
    localities: readNames(source.localities, 'localities'),
    localityBounds: readArray(source.localityBounds, 'localityBounds').map((entry, index) =>
      readLocalityBounds(entry, `localityBounds[${index}]`),
    ),
  }
}

/**
 * One area's box, checked hard because it is about to be handed to a camera.
 *
 * The check that matters is **ordering**, and it is the one a range check cannot make: a swapped
 * min and max are both perfectly valid New York coordinates, so "is this a plausible latitude" says
 * yes to an inside-out box. Handed to `fitBounds`, that box either frames nothing or throws inside
 * MapLibre, and the failure surfaces as a broken map rather than as a bad response.
 *
 * This is the same shape of bug the viewport containment check exists for, one level up: the values
 * are individually fine and their relationship is wrong.
 */
function readLocalityBounds(value: unknown, path: string): LocalityBounds {
  const source = readObject(value, path)

  const locality = readString(source.locality, `${path}.locality`)

  if (locality === '') {
    fail(`${path}.locality`, 'expected a locality name, got an empty string')
  }

  const minLatitude = readNumber(source.minLatitude, `${path}.minLatitude`)
  const maxLatitude = readNumber(source.maxLatitude, `${path}.maxLatitude`)
  const minLongitude = readNumber(source.minLongitude, `${path}.minLongitude`)
  const maxLongitude = readNumber(source.maxLongitude, `${path}.maxLongitude`)

  if (minLatitude > maxLatitude) {
    fail(`${path}.minLatitude`, `expected at most maxLatitude (${maxLatitude}), got ${minLatitude}`)
  }

  if (minLongitude > maxLongitude) {
    fail(
      `${path}.minLongitude`,
      `expected at most maxLongitude (${maxLongitude}), got ${minLongitude}`,
    )
  }

  return { locality, minLatitude, maxLatitude, minLongitude, maxLongitude }
}

/**
 * `GET /establishments/summary`.
 *
 * Every count is checked to be a non-negative integer, which is not ceremony: these numbers go
 * straight onto the landing page as claims about the data, and `-1` or `2.5` reaching a page that
 * says "23,528 establishments" would be the page inventing a number on the API's behalf.
 *
 * The relationship between the two establishment counts is checked as well. Never-inspected
 * establishments are a subset of all establishments, so a summary claiming more of the former than
 * the latter is internally inconsistent — and a page rendering it would print a percentage above
 * 100 rather than fail.
 */
export function readDatasetSummary(body: unknown): DatasetSummary {
  const source = readObject(body, 'response')

  const readCount = (value: unknown, path: string): number => {
    const count = readNumber(value, path)

    if (!Number.isInteger(count) || count < 0) {
      fail(path, `expected a count, got ${JSON.stringify(count)}`)
    }

    return count
  }

  const establishmentCount = readCount(source.establishmentCount, 'establishmentCount')
  const awaitingFirstInspectionCount = readCount(
    source.awaitingFirstInspectionCount,
    'awaitingFirstInspectionCount',
  )

  if (awaitingFirstInspectionCount > establishmentCount) {
    fail(
      'awaitingFirstInspectionCount',
      `expected at most establishmentCount (${establishmentCount}), got ${awaitingFirstInspectionCount}`,
    )
  }

  return {
    establishmentCount,
    awaitingFirstInspectionCount,
    inspectionCount: readCount(source.inspectionCount, 'inspectionCount'),
    localityCount: readCount(source.localityCount, 'localityCount'),
    cuisineCount: readCount(source.cuisineCount, 'cuisineCount'),
    // Null is a real answer — an empty database before the first ingestion run — and is distinct
    // from a malformed date, which still fails.
    latestInspectionOn:
      source.latestInspectionOn === null
        ? null
        : readPlainDateString(source.latestInspectionOn, 'latestInspectionOn'),
  }
}


/**
 * `GET /reports/outcome-breakdown`.
 *
 * Checked harder than the map responses, and for a different reason. A wrong pin is visibly in the
 * wrong place; a wrong number in a report is indistinguishable from a right one, and the reader has
 * already been told it is a finding.
 */
export function readOutcomeBreakdown(body: unknown): OutcomeBreakdown {
  const source = readObject(body, 'response')

  const dimension = readString(source.dimension, 'dimension')

  if (!(reportDimensions as readonly string[]).includes(dimension)) {
    fail(
      'dimension',
      `expected one of ${reportDimensions.join(', ')}, got ${JSON.stringify(dimension)}`,
    )
  }

  return {
    dimension: dimension as ReportDimension,
    rows: readArray(source.rows, 'rows').map((entry, index) =>
      readOutcomeBreakdownRow(entry, `rows[${index}]`),
    ),
    ungroupedEstablishments: readCount(
      source.ungroupedEstablishments,
      'ungroupedEstablishments',
    ),
    hasDateRange: readBoolean(source.hasDateRange, 'hasDateRange'),
  }
}

function readCount(value: unknown, path: string): number {
  const count = readNumber(value, path)

  if (!Number.isInteger(count) || count < 0) {
    fail(path, `expected a count, got ${JSON.stringify(count)}`)
  }

  return count
}

function readOutcomeBreakdownRow(value: unknown, path: string): OutcomeBreakdownRow {
  const source = readObject(value, path)

  const group = readString(source.group, `${path}.group`)

  if (group === '') {
    fail(`${path}.group`, 'expected a group name, got an empty string')
  }

  const row: OutcomeBreakdownRow = {
    group,
    total: readCount(source.total, `${path}.total`),
    neverInspected: readCount(source.neverInspected, `${path}.neverInspected`),
    noInspectionInPeriod: readCount(source.noInspectionInPeriod, `${path}.noInspectionInPeriod`),
    good: readCount(source.good, `${path}.good`),
    fair: readCount(source.fair, `${path}.fair`),
    poor: readCount(source.poor, `${path}.poor`),
    ungraded: readCount(source.ungraded, `${path}.ungraded`),
    pendingReinspection: readCount(source.pendingReinspection, `${path}.pendingReinspection`),
    inspected: readCount(source.inspected, `${path}.inspected`),
    poorShare: readProportion(source.poorShare, `${path}.poorShare`),
  }

  /*
   * The arithmetic a reader will do in their head, checked before they do it.
   *
   * Every establishment in a group is in exactly one bucket: it has a counted outcome, or it has
   * never been inspected, or it was inspected outside the period. A table whose columns do not add
   * up to its total is one a reader is right to distrust — and this is the failure that no type can
   * catch, because every individual number is a perfectly good non-negative integer.
   */
  const accounted = row.inspected + row.neverInspected + row.noInspectionInPeriod

  if (accounted !== row.total) {
    fail(
      path,
      `the columns do not account for the total: inspected ${row.inspected} + never inspected ` +
        `${row.neverInspected} + not inspected in period ${row.noInspectionInPeriod} = ` +
        `${accounted}, but total is ${row.total}`,
    )
  }

  const outcomes = row.good + row.fair + row.poor + row.ungraded + row.pendingReinspection

  if (outcomes !== row.inspected) {
    fail(
      `${path}.inspected`,
      `the five outcome counts sum to ${outcomes}, but inspected is ${row.inspected}`,
    )
  }

  return row
}

/**
 * A rate and its evidence, arriving together.
 *
 * `total` is rejected when it disagrees with the row's own `inspected`, elsewhere — here the check
 * is that the estimate is internally coherent, because ADR-0007's whole position is that a
 * percentage without a trustworthy denominator is not a finding.
 */
function readProportion(value: unknown, path: string): ProportionEstimate {
  const source = readObject(value, path)

  const count = readCount(source.count, `${path}.count`)
  const total = readCount(source.total, `${path}.total`)

  if (count > total) {
    fail(`${path}.count`, `expected at most total (${total}), got ${count}`)
  }

  const observed = readNumber(source.observed, `${path}.observed`)
  const supportedAtLeast = readNumber(source.supportedAtLeast, `${path}.supportedAtLeast`)

  for (const [name, rate] of [
    ['observed', observed],
    ['supportedAtLeast', supportedAtLeast],
  ] as const) {
    if (rate < 0 || rate > 1) {
      fail(`${path}.${name}`, `expected a proportion between 0 and 1, got ${rate}`)
    }
  }

  // A lower bound above the value it bounds is not a rounding artefact, it is a swapped pair — and
  // swapped, the table would rank confident large groups last. Both are valid proportions, so only
  // their relationship can catch it.
  if (supportedAtLeast > observed) {
    fail(
      `${path}.supportedAtLeast`,
      `a lower bound cannot exceed the observed rate: ${supportedAtLeast} > ${observed}`,
    )
  }

  return { count, total, observed, supportedAtLeast }
}


/**
 * `GET /reports/establishments`.
 *
 * The relationship checked here is the one no type can express: a null `outcome` and a null
 * `inspectedOn` must travel together. One without the other means a row claiming a result with no
 * date, or a date with no result — and a table would render either without complaint.
 */
export function readEstablishmentReport(body: unknown): EstablishmentReport {
  const source = readObject(body, 'response')

  return {
    rows: readArray(source.rows, 'rows').map((entry, index) =>
      readEstablishmentReportRow(entry, `rows[${index}]`),
    ),
    isTruncated: readBoolean(source.isTruncated, 'isTruncated'),
    hasDateRange: readBoolean(source.hasDateRange, 'hasDateRange'),
  }
}

function readEstablishmentReportRow(value: unknown, path: string): EstablishmentReportRow {
  const source = readObject(value, path)

  const outcome =
    source.outcome === null ? null : readOutcome(source.outcome, `${path}.outcome`)
  const inspectedOn =
    source.inspectedOn === null
      ? null
      : readPlainDateString(source.inspectedOn, `${path}.inspectedOn`)

  if ((outcome === null) !== (inspectedOn === null)) {
    fail(
      path,
      `outcome is ${outcome === null ? 'null' : JSON.stringify(outcome)} but inspectedOn is ` +
        `${inspectedOn === null ? 'null' : JSON.stringify(inspectedOn)}. They describe the same ` +
        'inspection and cannot disagree about whether it exists.',
    )
  }

  const isAwaitingFirstInspection = readBoolean(
    source.isAwaitingFirstInspection,
    `${path}.isAwaitingFirstInspection`,
  )

  // An establishment awaiting its first inspection cannot have a result. The reverse is not an
  // error: a place with inspections outside the selected period also has no result, which is the
  // distinction this row exists to preserve.
  if (isAwaitingFirstInspection && outcome !== null) {
    fail(
      path,
      `isAwaitingFirstInspection is true but outcome is ${JSON.stringify(outcome)}. An ` +
        'establishment that has never been inspected cannot have an inspection result.',
    )
  }

  return {
    id: readNumber(source.id, `${path}.id`),
    name: readString(source.name, `${path}.name`),
    addressLine: readNullableString(source.addressLine, `${path}.addressLine`),
    locality: readNullableString(source.locality, `${path}.locality`),
    cuisine: readNullableString(source.cuisine, `${path}.cuisine`),
    phone: readNullableString(source.phone, `${path}.phone`),
    isAwaitingFirstInspection,
    outcome,
    inspectedOn,
    rawGrade: readNullableString(source.rawGrade, `${path}.rawGrade`),
    rawScore: readNullableNumber(source.rawScore, `${path}.rawScore`),
    closedByAuthority: readBoolean(source.closedByAuthority, `${path}.closedByAuthority`),
  }
}
