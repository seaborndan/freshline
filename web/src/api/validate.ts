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
  type EstablishmentDetail,
  type InspectionDetail,
  type InspectionOutcome,
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
