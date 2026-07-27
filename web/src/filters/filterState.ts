import type { EstablishmentFilter } from '../api/contract'

/**
 * Whether anything is filtered at all.
 *
 * In its own module rather than beside the panel because two callers need it and a component file
 * that also exports functions breaks fast refresh — the panel uses it to decide whether a clear
 * control is worth showing, and the page uses it to tell "this area is empty" apart from "your
 * choices are". Those are different sentences and a user who cannot tell them apart concludes the
 * data is missing.
 */
export function hasAnyFilter(filters: EstablishmentFilter): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== '')
}
