# Development handoff

Updated 5 September 2026 by Codex. This is shared project context for the next Claude or Codex
session; it supplements `CLAUDE.md` and the milestone documentation.

## Latest change

Prospect cards now have **View on map** beside inspection history. `focus=1` requests an explicit
initial camera move, even when the restaurant is already inside the opening viewport. Saved lists
have a dedicated `/prospects/map?list=...` view backed by a bounded batch pin lookup; it fits only
the list's restaurants, reports unavailable locations, and links back to the selected saved list.
The list remains browser-local. Live checks verified individual centering and a saved-list pin.
Validation for this addition: 147 API tests passed; frontend, TypeScript, lint and build checked.

`feat/evidence-prospecting` follows the user's instruction to finish the remaining explorer issues
and then build the supplier workflow. Read `docs/prospecting.md` for the current behavior and
verification. This supersedes the earlier notes below about hybrid rendering and prefix-only search.
The map now uses full vector geometry and assembles complete viewport results by subdivision;
substring search is supported without removing the API prefix option. `/prospects` adds latest-
inspection evidence, named local lists, notes/status, undo removal, and CSV export.
Discovery now starts with all four opportunity categories: pest control, cleaning/sanitation,
food temperature control, and plumbing/handwashing. The API publishes the code catalog; choosing
a category changes the evidence query. List naming appears only when saving a result; names are
user-defined labels, not filters. Existing browser-local lists remain compatible. See prospecting
documentation for the evidence caveats and the API's backward-compatible omitted-category default.
No migrations, dependency additions, authentication changes, or grading changes were needed.
Physical-phone performance remains unverified; local lists do not synchronize across devices.
Full .NET validation passed: 143 API tests and 61 infrastructure tests. Frontend validation,
TypeScript, lint, and production build passed; all 289 frontend tests passed. Live category checks
confirmed sanitation results show only matching evidence and list naming opens when saving.

The `feat/polished-explorer` branch adds the first visual/UX pass requested by the user:
shared green/white branding, a dedicated desktop sidebar, a stacked phone layout, an expandable
map key, explicit partial-view emphasis, richer detail summaries, clickable phone numbers, and
updated report/landing styling. `experience.css` contains the visual treatment over the existing
component styles. Existing outcome colours and API ranking behavior are unchanged.

Results now page through already-loaded records in groups of 50, resetting when the response
changes. Pagination does not fetch the records omitted by a truncated API response. Reports
rename “Supported ≥” to “Conservative poor %” with an explanation; the calculation is unchanged.

Validation for this pass: all 280 frontend tests passed, TypeScript and lint passed, production
build passed with the existing large-bundle warning (MapLibre remains bundled into the entry).
Live browser checks covered desktop map, selection/detail, result filtering, reports and landing;
a 390×844 viewport showed no document-width overflow. This is a viewport simulation, not a
physical phone performance test. Temporary viewport overrides were reset.

## CARTO authentication (preceding change)

CARTO began watermarking unauthenticated basemap tiles. The map now uses `basemapRequest.ts`
through MapLibre's `transformRequest` to add a configured key only to CARTO basemap hosts.
The actual key is in ignored `web/.env.local` on this machine. Never copy it into Git or docs.
On another machine, follow `web/.env.example` and `docs/local-development.md`.

Rendering is still hybrid: raster geometry and vector labels from zoom 14 upward. CARTO has
announced raster retirement; full-vector migration is a follow-up requiring live performance
comparison, because the hybrid originally addressed panning and rotation stutter.

Validation: 27 tests passed across `basemapRequest.test.ts` and `MapView.test.tsx`; TypeScript
build checks passed. The actual browser map rendered without the watermark after configuration.
No full application test suite was run for this small change.

## Local runtime

The development app was started at http://127.0.0.1:5173 with the API at
http://localhost:5045 and database in the `freshline-sql` Docker container. Check whether these
are still running before launching duplicates. API readiness returned Healthy; the summary
returned 23,528 establishments and 29,601 inspections. These are existing local data, not a
fresh ingestion.

Docker Desktop initially crashed trying to remove `userAnalyticsOtlpHttp.sock`. Stopping its
failed processes and renaming its temporary `run` directory to `run-stale-20260905` allowed a
successful restart. Database volumes were preserved.

## User direction

The user wants live browser development/debugging and continuity between Claude and Codex.
They asked to document the CARTO change and push it to Git, then authorized a broader visual
and usability improvement pass. No full-vector migration has been requested. Update this handoff when leaving material work or
decisions for another session. Git shares committed files; conversation history and ignored
local settings do not travel with it.
