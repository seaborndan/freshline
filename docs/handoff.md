# Development handoff

Updated 5 September 2026 by Codex. This is shared project context for the next Claude or Codex
session; it supplements `CLAUDE.md` and the milestone documentation.

## Latest change

The ten-feature product pass adds general map saving, dated activity timelines, My day (/work),
saved-evidence checks, manual visit planning, saved-territory summaries, custom research (/research)
and real data health (/data). Read `docs/product-pass-ten-features.md` for exact behavior and limits.
Validation: 153 API tests and 334 frontend tests passed; TypeScript, lint and local-origin production
build passed. Initial JS is 294.66 kB; map chunk remains 952.72 kB with the existing size warning.
Saved map records allow absent inspections/evidence without weakening API discovery validation.
Activities survive transfer and restaurant JSON backup; visit plans and search bookmarks remain
separate local keys. No active authentication, migrations or new dependencies were added.

User chose Google accounts for teams. Concrete proposed architecture and setup requirements are
in ADR-0008; OAuth client/domain and auth/schema review are still required. Pre-permit research is
implemented using recorded inspection types, but verified opening/permit-issuance data is not.
Failed-run history is not persisted; data health says so rather than implying successful refresh.

CUA browser inspection recovered after reset during this pass. Live checks now cover map save,
activity logging/reload, visit stop selection/reordering, unchanged-evidence checks, pre-permit rules
(Queens + all codes 04N/08A returned 26 matches), and data health. Phone-width checks at 390px had
no horizontal overflow on research/data health. Temporary QA list/activities and visit stops were
removed; original GG/a lists preserved. This supersedes older notes saying all visual QA is blocked.
Data health reports 23,528 establishments, 29,601 inspections, 511 missing coordinates, last successful
ingestion July 26 and highest inspection date July 23. This pass did not run fresh ingestion.

Saved searches now optionally use rolling 7/30/90/180-day windows calculated on Run, inclusive of
the local current day. Existing bookmarks remain fixed-date. These filter inspection dates, not
ingestion timestamps; there is no background monitoring. Tests cover leap/year boundaries and old
bookmark compatibility. 325 frontend tests pass; lint/build checked. Live visual QA remains pending
because the browser automation runtime has been unavailable.

Restaurant details now compare latest citation codes with any earlier stored inspection. Three
expandable groups show latest-only, shared and comparison-only codes; full history remains below.
Same-day records explicitly have unknown within-day chronology. Missing codes do not imply resolution.
323 frontend tests pass; lint/build passed. Live API comparison verified TAL BAGELS has four shared
and fourteen prior-only codes between July 22 and July 17. Browser visual QA remains blocked by CUA
kernel-assets initialization. No grading logic or dependencies changed.

Discovery supports named saved searches under freshline.searches.v1, separate from restaurant lists.
Up to 50 fixed-date searches; save uses submitted filters, Run fetches again, removal has undo.
Duplicate names, unreadable storage and detected stale writes are protected. Restaurant JSON backups
do not include search bookmarks; the UI states this. 320 frontend tests pass, lint/build checked.
CUA still fails initializing kernel assets, so live visual verification remains outstanding.

Saved restaurants now support Copy or move to another list, preserving notes, status, dates and
evidence. Copy is the default; move explicitly removes the source membership and opens the destination.
Existing destination memberships are never overwritten, and failed writes keep the form available.
Validation: 317 frontend tests passed, lint and production build checked. CUA still fails before
tab access with a missing kernel-assets path; this UI has not had live visual verification.

Discovery now supports selecting individual restaurants or the visible page, retaining selections
across pages, and saving together to one destination. A preview counts new versus existing list
memberships; existing evidence, notes and status are preserved. New searches and mode changes clear
selection. Only unsaved places filters loaded results against all local lists, with explicit API-cap
and already-saved empty-state wording. No API or storage-schema changes.
Validation: 314 frontend tests passed; lint checked. Browser QA for this addition is blocked by the
CUA runtime failing to initialize (missing kernel asset path), including after reset; do not assume
a live visual check was completed. Follow-up: inspect batch controls at desktop and phone widths.

Added an across-list due agenda and downloadable text visit briefs. Agenda entries preserve each
restaurant/list membership and open the exact record; due dates refresh on focus and every minute.
Briefs include all currently filtered records (not just the visible page), notes, follow-up dates,
contact details and dated citation snapshots. No routing service, outreach or storage changes.
Validation: 310 frontend tests pass, lint and production build checked; local saved-work UI checked.

The autonomous product pass adds saved-list follow-up dates / due view, search and stage filters,
rename with collision protection, versioned JSON backup / previewed merge restore, and a manual
newer-inspection check that preserves saved evidence. Discovery filters are bookmarkable; cards
page by 20. Storage events synchronize tabs and a pre-write guard refuses detected stale edits.
Landing copy explains the supplier workflow and its evidence limits. See `docs/product-direction.md`
for evaluated ideas and parked owner decisions; no market-validation claim is made.

Map routes load lazily with a recoverable route error boundary. Build: entry 260.18 kB (79.86 kB
gzip), shared map JS 949.46 kB (248.00 kB gzip). The map chunk warning remains. List-map selection
centers the selected pin, its count is labeled as list membership, and Prospects stays active in
navigation. A clipped live announcement was anchored to prevent document overflow.

Validation: 306 frontend tests passed; TypeScript, lint and local-origin production build passed.
Live saved search and evidence checks worked without changing user records; 390px layout had no
horizontal overflow. Physical-phone performance and real-user product validation remain open.
No dependencies, migrations, authentication or grading changes were made in this pass.

Crash recovery: Docker Desktop failed again on its temporary analytics socket. After stopping its
processes, its verified local Docker/run directory was renamed to run-stale-20260905-recovery2,
then Desktop restarted and freshline-sql started. No database volumes were removed. API and Vite
were restarted on the existing ports. Check running processes before launching duplicates.

Saved-list maps use larger pins (10px radius, 12px for priority pins) with 3px outlines to make
sparse shortlists easier to spot. Outcome colors and the general explorer's sizing stay consistent.

The Saved lists tab badge counts distinct list names, not total saved prospects. Regression coverage
includes four saved prospects across two lists.

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
