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
 * | **Times Square, 0.005° × 0.0127°** | **369** | **no** |
 *
 * ## The shape matters as much as the size
 *
 * **This box is not what gets fetched.** `fitBounds` fits it *inside* the browser window, so the box
 * actually on screen is larger on whichever axis the window has room to spare — and it is the
 * on-screen box that the request is built from (see `App.tsx`).
 *
 * The first version of this constant was nearly square, 0.008° by 0.0106°, holding 518. On a
 * 1440×900 window `fitBounds` doubled its width to 0.0216°, and the box actually fetched held
 * **1,019** — nineteen over the limit. So the opening view of a map whose initial viewport had been
 * chosen specifically to avoid truncation was a truncation banner. Measured by loading the running
 * app and reading the viewport it reported, which is the only way this shows up: every number in the
 * table above was correct and none of them described what a browser would ask for.
 *
 * The fix is to shape the box like a window rather than like a square. A screen aspect of about
 * 1.9:1 corresponds to a longitude span roughly 2.5× the latitude span, because a degree of
 * longitude covers about 76% of the ground a degree of latitude does at this latitude. Fitted into a
 * normal window, this box is then very close to itself.
 *
 * What it holds, for these exact bounds: **369 establishments at 238 distinct points** — 199 `Good`,
 * 80 `Ungraded`, 76 never inspected, 12 `Fair` and **2 `Poor`**. No closures, and no
 * `PendingReinspection`, which is the latest outcome for no establishment anywhere.
 *
 * Keeping the two `Poor` cost a deliberate nudge north: the tier the product exists to surface is
 * 0.4% of the data, and an opening view without one of them shows a legend row that nothing on
 * screen demonstrates.
 *
 * **On a window twice as wide this still holds only 782 and does not truncate.** That is the margin
 * being bought; an ultrawide monitor or a portrait phone can still exceed the limit, and the
 * truncation banner is the honest answer there rather than a constant tuned to one screen.
 *
 * What a real browser actually fetches, since that is the number this file is ultimately about: on a
 * 1440×900 window the running app reports **424 places at 282 points**, untruncated. The gap from
 * 369 is `fitBounds` padding and the last of the aspect mismatch — small, which is the point.
 */

import type { Viewport } from '../api/viewport'

export const initialViewport: Viewport = {
  minLatitude: 40.7555,
  maxLatitude: 40.7605,
  minLongitude: -73.99183,
  maxLongitude: -73.97918,
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
