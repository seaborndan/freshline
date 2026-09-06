# Ten-feature product pass

## Usable implementation

1. **General map saving:** every restaurant detail can be saved, including records with no
   inspection or no citations. Empty evidence is represented honestly; discovery validation remains strict.
2. **Changes inbox:** My day / Changes checks saved restaurants against current API records,
   reporting date or recorded-code differences, progress, cancellation and partial failure. It does
   not infer ingestion times or overwrite saved evidence. Category snapshots do not represent full
   inspections, so extra unrelated codes are not treated as changes.
3. **Daily dashboard:** due counts, upcoming follow-ups and recent logged contact activity.
4. **Visit planner:** saved stops, a persisted visit date, manual ordering, removal and external
   directions links. No route optimization or invented travel times.
5. **Contact timeline:** dated notes/calls/visits/emails, append-only entry creation, removal with
   undo and independent histories per list. Nothing is sent when an activity is logged.
6. **Territory overview:** deduplicated saved restaurant counts by borough, membership contact
   progress and recorded cuisine mix. This is saved-work coverage, not total market share.
7. **Custom rules:** borough, cuisine, dates, exact citation codes with any/all matching and an
   explicit 200-result limit. Latest-inspection selection precedes filtering; submitted URLs are reusable.
10. **Data health:** current database counts, missing coordinates, successful ingestion timestamps
   and recorded ingestion scope. Failed-run history is not persisted, and is explicitly unavailable.

## Partial / staged items, not represented as complete

8. **New-business discovery:** shipped pre-permit inspection research as a source-grounded
   investigation signal. NYC's [pre-permit view](https://data.cityofnewyork.us/Health/Pre-Permit-Restaurant-Inspections/jzz4-5r78)
   is based on inspection records. It is not verified business opening / licence issuance data.
   A complete opening feed still needs an authoritative issuance/opening source, stable identity
   matching and mapping review. No never-inspected restaurant is labeled newly opened.
9. **Shared teams:** owner chose Google accounts. The concrete account, route, storage and test
   design is in [ADR-0008](adr/0008-google-team-workspaces-proposed.md). Real OAuth configuration,
   schema/auth review and multi-account verification remain required; team synchronization is not
   enabled. Browser-local lists are not silently uploaded or called shared workspaces.

## Local persistence

Restaurant snapshots now optionally include map provenance, cuisine and activities; older saved
records remain readable. Restaurant JSON backups preserve these fields. The one-day visit plan
uses `freshline.visit-plan.v1`; it and saved searches are separate from restaurant backups.
Calendar dates are local calendar days, not UTC timestamps. Storage errors do not claim success.

## Remaining product constraints

Real-user market validation, physical-phone behavior, Google team access and authoritative opening
data remain outstanding. This pass adds no dependencies, migrations or grading changes. Source
watermarks expose successful runs only; implementing complete failed-run history requires an
approved persistence design. A manual check against saved snapshots is not a push-alert service.
