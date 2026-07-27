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
 * How far the map lets anyone wander.
 *
 * **Measured from the data**, not drawn around a city on a map: every establishment with coordinates
 * falls inside latitude 40.499563 to 40.912822 and longitude -74.249101 to -73.701712 — 23,017 rows
 * on 2026-07-26. A margin of 0.02° (roughly two kilometres) is added on each side so an establishment
 * at the edge can be centred rather than pinned against the frame.
 *
 * **Why constrain it at all.** Not for the API's sake: past one degree the client already declines
 * to ask, so a world view costs zero requests. The costs are elsewhere and both are real. The
 * basemap keeps fetching and parsing tiles for places this product will never have data about, on
 * the same worker pool that competes with drawing the pins. And a map of the Atlantic with no dots
 * on it looks like a broken product rather than a product scoped to one city — which is the same
 * reasoning as the scope fence, applied to the camera.
 */
export const dataBounds = {
  minLatitude: 40.4796,
  maxLatitude: 40.9328,
  minLongitude: -74.2691,
  maxLongitude: -73.6817,
}

/**
 * The furthest out the map will zoom.
 *
 * A compromise, and worth saying which way it errs. At zoom 9.5 a normal desktop window shows a
 * little more than the whole city — enough to get your bearings. Lower would allow a view of the
 * eastern seaboard; higher would stop a narrow phone window from ever seeing the city whole.
 *
 * **Zoomed fully out, a wide window shows no pins**, and that is worth being precise about rather
 * than glossing: on a 1440px window this zoom spans about 1.4° of longitude, past the degree the API
 * will answer, so the page says "zoom in to load establishments". No value fixes that for every
 * screen — the span depends on the window's width, so a minimum zoom that keeps an ultrawide monitor
 * under a degree would stop a phone from seeing the city at all. The one-degree guard is the real
 * backstop; this constant just stops the map showing the Atlantic.
 */
export const minimumZoom = 9.5

/**
 * The zoom below which the basemap's labels are not drawn.
 *
 * **Measured from a complaint, not from taste.** Panning and rotating were reported as smooth at a
 * viewport of 0.0376° by 0.0503° and jittery any further out. The pins are not what changes: that
 * box and one three times its size both return exactly 1,000 establishments, because both truncate.
 * What changes is the basemap. CARTO Positron is 95 layers — 56 line layers and **27 symbol
 * layers** — and symbol layers are the expensive ones to move: MapLibre recomputes label placement
 * and collision on the main thread, and re-runs it on every rotation. Zoomed out over New York there
 * are far more labels competing for space.
 *
 * So labels are restricted to the zooms where they are worth their cost. Below this, the map is
 * roads and water and dots, which is what an overview of a city is for; above it, street names
 * appear, which is when they start telling you where you are.
 *
 * This is the single number to change if the trade needs adjusting in either direction.
 */
export const labelMinimumZoom = 14

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
 *
 * **Only its labels and its lettering are used.** See `basemapRasterTiles` for why, and for what
 * replaces the rest of it.
 */
export const basemapStyleUrl = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

/**
 * The basemap's geometry, as pictures rather than as data.
 *
 * **Why a second source exists at all.** Vector tiles have to be parsed before they can be drawn,
 * and that parsing is what makes a map stutter when it moves into somewhere new. Measured against
 * CARTO on 2026-07-26, over Manhattan:
 *
 * | | vector (.mvt) | raster (.png, @2x) |
 * |---|---|---|
 * | zoom 12 | 98KB | 30KB |
 * | zoom 14 | **389KB** | 26KB |
 * | zoom 15+ | *does not exist* | — |
 *
 * That last row is the whole explanation of a symptom reported from a browser: panning and rotating
 * were smooth above zoom 14 and jittery below it. CARTO's vector tiles stop at 14, so every zoom
 * above it **overzooms** — MapLibre scales tiles it has already parsed and parses nothing new.
 * Below 14 it parses a fresh few hundred kilobytes of geometry for every new area moved into, and
 * the further out the camera is, the more new area each gesture exposes. The boundary between smooth
 * and jittery was exactly the boundary where parsing stops.
 *
 * A raster tile is an image. It is decoded off the main thread and drawn as a texture, so moving
 * across it costs nothing to parse at any zoom.
 *
 * **The labels stay vector, and that is the point of the arrangement.** Raster basemaps normally
 * come with their lettering baked into the picture, which rotates with the map — turn it far enough
 * and the street names are upside down, permanently, because nothing is placing them. So this uses
 * the *no-labels* raster for geometry and keeps Positron's own symbol layers over the top, where
 * MapLibre places them dynamically and they stay upright at any bearing.
 *
 * And because MapLibre only fetches a source's tiles when a visible layer needs them, restricting
 * those symbol layers to zoom 14 and up means **no vector tile is fetched or parsed below zoom 14 at
 * all** — the zooms that were jittery become pure raster, and the zooms where labels appear are the
 * ones already served by overzoomed tiles.
 *
 * The cost, stated: two third-party endpoints instead of one, and a style assembled here rather than
 * handed to MapLibre as a URL.
 */
export const basemapRasterTiles = 'https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png'

/**
 * Shown for the raster source. The vector source carries its own from its TileJSON, but below zoom
 * 14 nothing is using the vector source, and a basemap on screen with no credit under it would be
 * wrong.
 */
export const basemapAttribution =
  '<a href="https://carto.com/attributions">© CARTO</a>, © OpenStreetMap contributors'
