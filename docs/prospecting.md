# Inspection evidence to prospect lists

Freshline's first supplier workflow targets pest-control prospecting. Open `/prospects`, choose a
borough and inspection date range, inspect the cited evidence, then save useful places to a named
list. Lists support contact stage, notes, removal with undo, and CSV export. Map links open the
restaurant's full inspection history. No message or call is sent automatically.

## What qualifies

The query selects each establishment's latest recorded inspection by date, then ID for same-date
ties. It must fall inside the requested period and cite at least one of these NYC codes:

- `04L`: evidence of mice.
- `04N`: flies or other nuisance pests.
- `08A`: harborage or conditions conducive to pests.

The response retains the source's actual descriptions; the list above is only a short explanation.
These three signals are intentionally a narrow starting set, not a complete taxonomy of pest
violations. A newer inspection without these citations excludes older evidence, even when the
newer inspection is outside the selected date range. A citation is a reason to investigate, not
proof of an unresolved problem, an unmet service need, or a vendor contract opportunity.

`GET /api/v1/prospects?locality=Queens&from=2026-06-01&to=2026-09-05` returns up to 200 matches,
newest inspection first with establishment ID breaking ties. `isTruncated` is explicit; narrow
the territory/dates when true. It uses the existing report rate-limit policy. Defaults are today
and 180 days earlier. No schema, authentication, or grading changes were made.

## Saved work

Lists are stored under `freshline.prospects.v1` in browser local storage, not on the server. Choose
or type a list name. The same restaurant can belong to several lists, each with independent notes
and status. Reloading preserves saved records. Browser profiles, origins (`localhost` versus
`127.0.0.1`), and devices have separate storage. Clearing browser data loses those records;
export CSV to keep a copy. CSV exports preserve evidence, inspection dates, notes, stage, and the
detail URL, using the existing formula-escaping export helper.

Saved evidence is a dated snapshot. It is not silently refreshed; open the history before acting.
Unreadable storage is reported and not overwritten. Storage failures are shown rather than
claiming the change was saved. Shared/cloud lists remain future work requiring a deliberate
authentication and persistence design.

## Explorer corrections

- `nameContains` adds literal substring search while `nameStartsWith` remains supported by the API.
  The map's Restaurant name field uses the new option; shared `?name=` links now match substrings.
  Substring search can scan names, unlike a prefix index seek. It is suitable for this bounded NYC
  dataset but should be measured before increasing scope.
- The UI discards truncated map samples and recursively divides the viewport along its longer
  axis, requesting up to 5,000 records in child requests. Inclusive boundaries are deduplicated by
  establishment ID. Only the complete assembled answer is published. Work is cancellable and
  sequential, capped at 40 requests / 12 subdivision levels; excessive density or failures show an
  error rather than publishing an incomplete count. Existing pins can remain while loading/error
  messages are visible. This is not an atomic snapshot across concurrent ingestion.
- Geometry and labels now use CARTO vector tiles. The raster replacement was removed. Label
  density remains reduced below zoom 14, and clustering/caching/deferred marker updates remain.

## Verification, 5 September 2026

API tests cover substring versus prefix search, exact evidence selection, a newer clean inspection,
and invalid date ranges. Frontend tests cover subdivision, shared boundary deduplication, cancellation,
bounded work, named lists, reload persistence, and unreadable storage.

Live checks: the map displayed 3,774 places with good results included after zooming beyond the old
1,000-place cap. Searching `burger` in the tested Manhattan/Queens viewport returned 118 matches,
including names where the word occurs in the middle; the request took 248 ms in a local shell check.
The first tested Queens prospect query returned 200 matches with truncation reported, taking 1,377 ms
including initial query compilation. These are individual observations, not latency benchmarks.
Saved test notes/status survived a browser reload; the temporary verification record was removed.

Vector geometry and labels were visually checked at multiple zoom levels. Responsive checks used
a 390×844 browser viewport; they do not establish physical-phone frame rate, touch behavior, or
battery use. Real-phone performance remains unverified. The production bundle size warning is
also still present; route-level loading is a future performance improvement.
