# Inspection evidence to prospect lists

Open `/prospects`, choose an opportunity type, borough, and inspection date range, inspect the
cited evidence, then save useful places to a named
list. Lists support contact stage, notes, removal with undo, and CSV export. Map links open the
restaurant's full inspection history. No message or call is sent automatically.

## What qualifies

The query selects each establishment's latest recorded inspection by date, then ID for same-date
ties. It must fall inside the requested period and cite a code in the selected category. Discovery
starts with all categories; selecting a type and pressing **Find prospects** changes the query:

- **Pest control:** `04L`, `04N`, `08A` — mice, nuisance pests, or harborage conditions.
- **Cleaning & sanitation:** `06D`, `10F` — food-contact sanitation or other surface conditions;
  some citations also concern surface construction.
- **Food temperature control:** `02G` — cold food above required temperatures. This may involve
  handling or equipment; it does not establish a refrigeration fault.
- **Plumbing & handwashing:** `10B`, `05D` — drainage, backflow, wastewater, or handwashing
  facilities. Some citations concern supplies or access rather than repairs.

The response retains the source's actual descriptions; the list above is only a short explanation.
These are initial evidence groups, not a complete taxonomy of restaurant supplier needs.
A newer inspection without matching citations excludes older evidence, even when the
newer inspection is outside the selected date range. A citation is a reason to investigate, not
proof of an unresolved problem, an unmet service need, or a vendor contract opportunity.

`GET /api/v1/prospects/categories` publishes the labels, descriptions, and code mappings used by
the UI. Category IDs are `pest-control`, `sanitation`, `temperature`, and `facilities`; `all` searches
their union. Unknown categories return 400. Omitting category preserves the original API's
pest-control default for compatibility; the UI explicitly sends `all` on first load.

`GET /api/v1/prospects?category=sanitation&locality=Queens&from=2026-06-01&to=2026-09-05` returns up to 200 matches,
newest inspection first with establishment ID breaking ties. `isTruncated` is explicit; narrow
the territory/dates when true. It uses the existing report rate-limit policy. Defaults are today
and 180 days earlier. No schema, authentication, or grading changes were made.

## Saved work

Both discovery and saved cards offer **View on map**, which centers and selects the restaurant,
alongside **View inspection history**. **View entire list on map** opens `/prospects/map?list=...`,
fits the selected list's pins, and offers the normal map selection/details. The list name refers to
this browser's local storage, so the link alone does not share a list with another user.
**Back to saved list** restores the selected list. Missing coordinates/deleted records are counted
as unavailable; pins use current inspection outcomes, while saved evidence remains its original snapshot.
`GET /api/v1/prospects/map?ids=...` accepts 1–200 positive IDs per request, deduplicates them, and
returns only matching establishments with coordinates. Larger lists use sequential batches.

Lists are stored under `freshline.prospects.v1` in browser local storage, not on the server. Click
**Save to list** on a result, then choose an existing list name or type your own. There is no
hardcoded list name; a name labels saved work and never changes the discovery query. Older saved
lists keep their existing names. The saved view lets you switch between your actual lists.
The same restaurant can belong to several lists, each with independent notes
and status. Reloading preserves saved records. Browser profiles, origins (`localhost` versus
`127.0.0.1`), and devices have separate storage. Clearing browser data loses those records;
download a JSON backup to restore later. CSV exports preserve evidence, inspection dates, notes, stage, follow-up date, and the
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
category filtering/catalog/validation, and invalid date ranges. Frontend tests cover category selection
independent of list naming, subdivision, shared boundary deduplication, cancellation,
bounded work, named lists, reload persistence, and unreadable storage.

Live checks: the map displayed 3,774 places with good results included after zooming beyond the old
1,000-place cap. Searching `burger` in the tested Manhattan/Queens viewport returned 118 matches,
including names where the word occurs in the middle; the request took 248 ms in a local shell check.
The first tested Queens prospect query returned 200 matches with truncation reported, taking 1,377 ms
including initial query compilation. These are individual observations, not latency benchmarks.
Saved test notes/status survived a browser reload; the temporary verification record was removed.

Vector geometry and labels were visually checked at multiple zoom levels. Responsive checks used
a 390×844 browser viewport; they do not establish physical-phone frame rate, touch behavior, or
battery use. Real-phone performance remains unverified. Map routes now load lazily: the initial
JavaScript entry is 260.18 kB and the shared map chunk is 949.46 kB in the local production build.
The large map-chunk warning remains; these sizes are not network or phone-performance benchmarks.

## Working a territory

Saved searches names and stores the submitted category, borough and exact date range in this
browser. Run search reloads results and restores those filters; it does not store a result snapshot
or advance the date range. Up to 50 names are supported. Removal offers undo, existing names cannot
be overwritten, and detected changes from another tab stop stale writes. Search bookmarks use
freshline.searches.v1 and are separate from restaurant-list JSON backups.

Saved cards offer Copy or move to another list. Choose an existing destination or name a new one.
Copy preserves the source; move removes its membership and opens the destination list. Both carry
notes, stage, follow-up date and saved evidence. If the restaurant is already at the destination,
the operation is blocked rather than merging or overwriting independent work.

Discovery cards can be selected individually or a page at a time. Selection survives pagination
but clears for a submitted search, workspace mode change or unsaved-filter change. The batch save
form previews new versus existing memberships in the destination list. It adds only new entries,
preserving existing notes, dates, stage and evidence; storage errors leave the selection available.
Only unsaved places excludes restaurants already in any local list. It filters the loaded API
results, not the full city, and does not fetch replacements beyond the existing 200-record cap.

The across-list agenda shows all due follow-ups, oldest first, excluding Not a fit. Each list
membership retains its own date and opens the exact restaurant in that list. Clear saved filters
or Show full list returns to the complete list. Dates refresh while the page remains open.

Download visit brief creates an offline plain-text file for every record in the filtered view,
including records on other pages. It includes personal notes, published contact details, dated
evidence, follow-up dates and space for conversation notes. It is not a route optimizer or a backup
format. The existing JSON backup remains the restoration format.

Submitted category, locality and date filters are stored in the URL for bookmarking. Draft edits
take effect on Find prospects. Discovery shows the latest inspection date in the local dataset;
this is not a claim of live city data. Results and saved cards page in groups of 20.

Saved lists can be renamed (existing names cannot be overwritten), searched by restaurant,
address, locality or notes, and filtered by stage. Follow-up dates use local calendar days.
The due view includes overdue records and excludes Not a fit. Dates are reminders inside this
workspace; no notification or outreach is sent. Existing records without a date remain compatible.

Check for newer inspection reads the current dataset and compares its latest inspection with
the saved snapshot. It reports repeated saved citation codes where applicable. An absent citation
does not establish resolution. Neither the saved evidence nor user notes are overwritten.

Backup & restore downloads a versioned JSON workspace. Restore accepts files up to 5 MB and
10,000 records, previews the number of new memberships, and requires Restore new records before
writing. Existing restaurant/list memberships win, preserving their current notes and dates.
Backups are user-managed files and include notes. No server upload occurs. CSV is for sharing /
analysis, not round-trip restoration. Other-tab storage changes are synchronized and detected stale
edits are refused; this is a local safeguard, not transactional multi-user storage.

The September product pass passed 306 frontend tests, TypeScript, lint and a production build
configured with the local API origin. Live checks covered saved filtering and evidence lookup,
and a 390px viewport had no horizontal overflow. See `product-direction.md` for hypotheses and
owner decisions; real-user demand has not been validated.
