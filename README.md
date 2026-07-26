# Freshline

Sales intelligence for companies that sell to restaurants. Freshline aggregates public health-inspection and
business-licence data from city open-data portals, normalises it into one schema, scores each establishment,
and puts the result on a map you can filter and work through.

**Status: in development.** This README was written before the code, as a design document. Sections describing
behaviour that does not exist yet are marked _(planned)_. Nothing here is claimed as working until it is.

---

## Why this exists

If you sell to restaurants — food distribution, pest control, POS systems, kitchen equipment, commercial
insurance — the useful question is not "who are the restaurants near me." Every list broker sells that. The
useful question is **"which restaurants are about to need what I sell, and why do I think so."**

That signal is sitting in public data. Health inspection results are published by most large US cities, in the
open, with coordinates. An establishment whose inspection scores have degraded across three visits, or that
just picked up a critical violation on refrigeration, or that has just been licensed and has no inspection
history at all, is a materially different prospect from the one next door. Nobody is joining that up, because
each city publishes it in a different shape and none of them publish it as a sales signal.

Freshline is the join.

The honest secondary reason: I wanted to own the whole shape of a system once — schema, ingestion, API,
front end, deployment, monitoring — rather than adding features to architecture somebody else designed.

## What it does

- **Ingests** inspection and licence data from multiple city open-data portals on a schedule, incrementally,
  without creating duplicates when a run overlaps a previous one.
- **Normalises** the wildly different per-city schemas into one establishment/inspection/violation model, and
  records exactly what each source field was mapped from.
- **Scores** each establishment on inspection trend, critical-violation recency, and licence age, so a
  salesperson can sort by "worth a call" rather than by distance. _(planned)_
- **Maps** the results — clickable establishments coloured by score tier, with a legend, filterable by city,
  cuisine, grade, and score band. _(planned)_
- **Saves territories** so a user can return to a filtered geographic slice, and get told what changed in it
  since last time. _(planned)_

## Architecture

```mermaid
flowchart LR
    subgraph Sources["City open-data portals (Socrata)"]
        NYC[NYC DOHMH]
        CHI[Chicago]
        OTHER[...]
    end

    NYC & CHI & OTHER --> ING

    subgraph Azure
        ING[Ingestion worker<br/>incremental, idempotent]
        DB[(Azure SQL<br/>EF Core + spatial index)]
        API[ASP.NET Core Web API<br/>OpenAPI · JWT · paginated]
        WEB[React + TypeScript<br/>MapLibre GL]

        ING --> DB
        DB --> API
        API --> WEB
    end
```

Ingestion is a background worker rather than a request-triggered job: the work is periodic, long-running, and
must not be tied to a user waiting on an HTTP response. Each source has its own connector implementing a
common interface, so adding a city is a new connector and a row of configuration, not a change to the pipeline.

Establishments are stored with a SQL Server `geography` point and a spatial index, because every meaningful
query in the product is "what is in this part of the map, matching these filters" and doing that with raw
latitude/longitude comparisons stops working as soon as there is more than one city in the database.

**What I would do differently at 100× the volume:** _(to be written once there are real numbers to reason
about — see Measured results)_

## Data sources

All public, all free, no payment tier. Verified 2026-07-25.

| Source | What it provides | Access |
|---|---|---|
| [NYC Open Data — DOHMH Restaurant Inspections](https://data.cityofnewyork.us/Health/NYC-Restaurant-Inspection-Results/gv23-aida) | ~296K inspection records with grades, scores, violations, cuisine, coordinates | Socrata API, no token under 1,000 req/hr |
| Chicago, Los Angeles, and other Socrata portals | Equivalent datasets in different schemas | Same API surface, different field names |

Per-city schema differences are the point, not an obstacle — see [ADR-0002](docs/adr/0002-per-source-connectors-and-a-canonical-schema.md).

## Notable engineering decisions

Full set in [`docs/adr/`](docs/adr/).

- [ADR-0001](docs/adr/0001-record-architecture-decisions.md) — why this project records decisions at all.
- [ADR-0002](docs/adr/0002-per-source-connectors-and-a-canonical-schema.md) — per-source connectors mapping
  into one canonical schema, rather than a shared generic ingester or a table per city.

## Measured results

Deliberately empty. This section will hold real before/after numbers — query timings with execution plans,
ingestion throughput, index impact — or it will stay empty. It will not hold estimates.

## Stack

**Backend** — C# / .NET 10, ASP.NET Core Web API, Entity Framework Core, Azure SQL (SQL Server locally)
**Frontend** — React, TypeScript, Vite, MapLibre GL JS
**Infrastructure** — Azure, Bicep, GitHub Actions
**Testing** — xUnit, Vitest, React Testing Library

## Running locally

_(planned — these steps will be verified against a clean clone before they are claimed to work)_

```bash
docker compose up -d          # SQL Server
dotnet run --project src/Freshline.Api
npm --prefix web run dev
```

## What's next

Current milestone and everything not yet built are tracked in [`docs/roadmap.md`](docs/roadmap.md).

## Engineering log

[`docs/ai-engineering-log.md`](docs/ai-engineering-log.md) records how AI tooling was used on this project per
milestone — what was delegated, what was kept, what was rejected, and how it was verified. Including the
places where I took the tool's word for something.

## Licence

MIT — see [LICENSE](LICENSE).
