/**
 * Where the map opens.
 *
 * **Measured, not chosen by eye.** A whole-city view is not an option: 23,017 drawable
 * establishments against a limit of 5,000 — the largest the API allows — comes back truncated, so the
 * first thing a stranger would see is a caveat. The API also refuses a viewport wider than one degree
 * on either axis, which makes a zoomed-out world map an error rather than an empty result.
 *
 * This box was picked by querying the API for candidates on 2026-07-26 and reading `isTruncated`:
 *
 * | Candidate | Pins | Truncated at 1,000 |
 * |---|---|---|
 * | Whole city, 0.43° × 0.56° | 5,000+ | yes |
 * | Midtown ±0.02° | 4,281 | yes |
 * | Midtown ±0.01° | 2,399 | yes |
 * | **Times Square, 0.008° × 0.0106°** | **518** | **no** |
 *
 * 518 leaves headroom under the 1,000 limit, and the box happens to contain every state the data
 * actually has: 258 `Good`, 132 never inspected, 116 `Ungraded`, 10 `Fair`, 2 `Poor`, and one closure.
 * Every legend row except `PendingReinspection` — which is the latest outcome for no establishment
 * anywhere — is therefore visible at first paint, which is what the acceptance criterion asks for.
 *
 * The counts are for these exact bounds, queried again after they were committed. The sweep that
 * chose the box used a slightly narrower one and returned 517; a number that is nearly right is
 * still wrong, and this is the sort of place it silently becomes documentation.
 */

import type { Viewport } from '../api/viewport'

export const initialViewport: Viewport = {
  minLatitude: 40.752,
  maxLatitude: 40.76,
  minLongitude: -73.9908,
  maxLongitude: -73.9802,
}

/**
 * The basemap.
 *
 * **CARTO Positron**, served from `basemaps.cartocdn.com` with no API key. This is a runtime
 * dependency on a third party and is named as one: if that CDN is down, the pins draw on a blank
 * background rather than on streets, and the page still works. Attribution for CARTO and
 * OpenStreetMap comes from the style document itself and MapLibre renders it.
 *
 * Positron rather than a standard OpenStreetMap style because it is greyscale by design — it gives
 * up its own colour so that the data on top of it can have some. A full-colour basemap would put
 * green parks and red roads underneath a scale whose whole meaning is green-ish and red-ish dots.
 *
 * Rejected: MapTiler and Stadia, which are better basemaps and need an API key — a key in a client
 * bundle is a key in the repository, and this milestone has no secret to protect and intends to keep
 * it that way. Raster OpenStreetMap tiles, whose usage policy asks applications not to use them.
 */
export const basemapStyleUrl = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
