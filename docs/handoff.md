# Development handoff

Updated 5 September 2026 by Codex. This is shared project context for the next Claude or Codex
session; it supplements `CLAUDE.md` and the milestone documentation.

## Latest change

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
They asked to document the CARTO change and push it to Git. No full-vector migration or other
UI redesign has been requested. Continue to update this handoff when leaving material work or
decisions for another session. Git shares committed files; conversation history and ignored
local settings do not travel with it.
