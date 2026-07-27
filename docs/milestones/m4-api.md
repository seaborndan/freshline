# M4 — API

The working brief for the milestone. Scope, constraints, and the decisions taken before any code was
written, kept so the reasoning survives the sitting it was decided in.

Roadmap entry: [M4](../roadmap.md). Decisions that outlive the milestone graduate to an ADR; this
file is the scope fence, not the decision record.

**Done when:** a stranger can explore live API documentation and every endpoint is correct on verbs,
status codes, and error shape.

---

## Deliverables

- Establishment list with filtering and keyset pagination
- Establishment detail with inspection history
- Map query by viewport
- OpenAPI document and a health check
- `ProblemDetails` on every failure path, with correct status codes
- Rate limiting on anything expensive
- JWT auth

---

## Scope fence

**One source: NYC DOHMH restaurant inspections.** No second city, no second dataset, no
business-licence feed. M2 was cut and the reasoning is in the roadmap.

The test: *if something being built implies multiple sources, that is a signal to re-read the scope,
not to widen it.*

---

## Decisions taken before implementation

### The map is public

Establishment list, detail, and map queries are **anonymous**. No login, no signup.

The reason is not technical. This URL goes on a résumé at M5, and anything standing between a hiring
manager and a working map is a reason for them to close the tab.

JWT auth is still built, because M6's per-user features — saved territories, "what changed since you
last looked" — need identity, and retrofitting an auth surface onto a live API is worse than building
it alongside. Rate limiting applies to the public endpoints regardless of authentication.

**The rule that does not bend:** if an endpoint triggers or controls ingestion, it is authenticated.

### The API validates tokens and does not issue them

Recommended, accepted, and recorded here so it is not relitigated. Token issuance is a separate
concern with its own storage, password handling, and rotation story; M4 needs the *validation* half
to exist so M6 has something to hang identity on. Tests mint tokens with a test key.

### Architecture

Endpoints do HTTP only. Queries live in Infrastructure behind an interface defined in Core.

Core has exactly **one** package reference — NetTopologySuite, argued in
[ADR-0004](../adr/0004-spatial-types-in-core.md). A second needs its own argument, not precedent.

---

## Query-shape constraints

These are conclusions from the M3 measurements, not preferences. See
[`docs/performance.md`](../performance.md).

- **The map list query uses a bounding box on `Latitude` / `Longitude`, not the spatial index.** The
  spatial predicate cost 40,359 logical reads against 16,933 for the bounding box.
- **The spatial index exists for radius queries only**, where a bounding box cannot ask the question.
- **Get the latest inspection with `APPLY`, not correlated subqueries.**

### The correction found during M4

`docs/performance.md` measured the map list query with **`CROSS APPLY`**, which is an inner join: an
establishment with no inspection is dropped from the result entirely.

Measured against the M3 viewport (lat 40.700–40.775, lon −74.020 to −73.960) on 2026-07-26:

| | |
|---|---|
| Establishments in the viewport | 7,290 |
| Returned by the `CROSS APPLY` query | 5,983 |
| **Silently dropped** | **1,307** |

Those 1,307 are the never-inspected establishments — precisely the greenfield signal M6's scoring is
built on. The fix is left-join semantics.

Counted across the whole table rather than one viewport, `CROSS APPLY` returns **19,923 of 23,528** —
3,605 missing, exactly the count awaiting a first inspection. Slice 2 fixed this for the list
endpoint and proved it: a walk of the live endpoint returns all 23,528 rows with no duplicates.

**The M4 number will not be comparable to M3's 16,933**, because the two queries answer different
questions. That has to be said wherever the numbers appear together rather than presented as a
regression.

### Slice 5 — what rate limiting and CORS actually bound

Both are framework features. **No package was added**, which is worth stating because CLAUDE.md makes
a dependency an explicit decision: `Microsoft.AspNetCore.RateLimiting` and `System.Threading.RateLimiting`
ship in the ASP.NET Core shared framework, and the build confirms it — the API's `.csproj` is
unchanged.

**A token bucket per client IP, not a fixed window.** A fixed window lets a caller spend the whole
allowance at the end of one window and the whole allowance again at the start of the next — twice the
intended rate, decided by where their burst happens to land relative to a clock. A token bucket
refills continuously and has no boundary to sit on. It also matches the traffic: panning a map fires
several requests in a second or two and then nothing for a minute, which is the normal shape here
rather than abuse.

**One bucket across all three endpoints, not one per endpoint.** The map query is the expensive one,
but every endpoint here reaches the database, and what needs bounding is the load one caller can put
on that database. Three buckets would let one caller spend three budgets.

**The health checks and the OpenAPI document sit outside it.** A readiness probe is polled constantly
from a handful of addresses — exactly what a per-IP limiter reads as abuse. Throttling it returns a
429 to the load balancer, which reads that as an unhealthy instance and pulls it from rotation: the
rate limiter becomes the outage. There is a test for this.

**`UseCors` is registered before `UseRateLimiter`, and the order is load-bearing.** CORS attaches its
headers on the way in, so a 429 produced later still carries them. Reversed, a browser gets a 429 it
is not allowed to read and reports a generic network error — the client cannot tell "slow down, retry
in 30 seconds" from "the API is down", which is the only thing a 429 exists to say. There is a test
that fails on that reversal and on nothing else.

**CORS is a configured origin list with credentials off.** There is a real argument for
`AllowAnyOrigin` here — the data is public, the endpoints are anonymous, and CORS protects a user's
credentials rather than the data. It is rejected because slice 6 puts an `Authorization` header on
this API and a permissive list is one `AllowCredentials()` away from letting any site make
authenticated calls with a visitor's session. Credentials stay off permanently, not until auth
arrives: bearer tokens are attached explicitly by JavaScript and cross origins without it, so turning
it on would only add automatic cookie sending — the mechanism CSRF runs on — for a capability this
API does not use.

**The Development origin default lives in code, not in `appsettings.Development.json`.** That file is
in `.gitignore`, so an origin put there would exist on one machine and every other developer — and CI
— would get an API the M5 web app cannot call, failing as a CORS error in the browser console rather
than as anything pointing at configuration. The fallback is committed, applies only under
`IsDevelopment()` with nothing configured, and there is a test asserting a non-Development
environment with nothing configured allows nothing.

**The limits are chosen, not measured**, and are labelled that way in `RateLimitOptions`. 60 burst,
30 tokens per 10 seconds. Nothing has established what this API can serve; that needs a load test
against deployed hardware, and `docs/performance.md` is explicit that its figures come from one
unconstrained workstation with the whole database in memory. No number from slice 5 appears in
`performance.md`, because slice 5 measured nothing.

**Verified live, not just in tests.** The in-memory test host sets no `RemoteIpAddress`, so every
test request falls into the same partition and the per-IP claim is the one thing the test suite
cannot prove. Checked against the real API over real sockets on 2026-07-26: 127.0.0.1 was driven to
429 while 192.168.1.192 got a full fresh bucket from the same instance, and `/health`,
`/health/ready` and `/openapi/v1.json` all answered 200 from the exhausted address. That run also
caught a defect no test had: the rejection message divided the two replenishment settings into a
per-second rate and told callers the API allows "roughly 0 requests per second". It now states the
configured numbers verbatim. The Development CORS fallback was verified the same way and for the same
reason — the test host runs as `Testing` and deliberately never as `Development`.

---

## Correctness traps

Each of these throws nothing when you get it wrong, which is what makes them worth writing down.

- **Coordinate order.** NetTopologySuite `Point` takes `(X, Y)` — *longitude first*. T-SQL
  `geography::Point` takes *latitude first*. A swap throws nothing and relocates every restaurant to
  the Southern Ocean.
- **Grade has six values** — `A`, `B`, `C`, `N`, `Z`, `P` — and is **null on over half of all rows**.
  Never derive a grade from a score; the ranges overlap.
- **`Latitude`/`Longitude` and `Location` say the same thing.** `Location` is derived on write. They
  cannot be allowed to disagree.

---

## Slices

Documentation for each slice is written **as part of that slice**, not deferred — the numbers are
still on screen and nothing gets written from recollection.

| # | Slice | Status |
|---|---|---|
| 1 | Read-path seam, API foundation, detail endpoint | ✅ `61e1aa8` |
| 2 | List with filtering and keyset pagination — **includes a migration** | ✅ |
| 3 | Detail with inspection history — query-count assertion | ✅ |
| 4 | Map viewport query — bounding box, left join | ✅ |
| 5 | Rate limiting and CORS | ✅ |
| 6 | JWT auth surface | not started |
| 7 | Consolidation — ADR-0005, README, roadmap, log | not started |

**Needs line-by-line human review before merge:** the slice 2 index migration, and all of slice 6.

---

## Running it locally

[`docs/local-development.md`](../local-development.md) has the general setup — the container, the
connection string, browsing the database, and why Visual Studio 2022 cannot build this at all. It
merged to `main` in PR #6 while M4 was in progress; an earlier version of this section duplicated a
subset of it under a note saying it was unavailable, and that duplication is gone.

What follows is only the part specific to working on the API.

**Running the API outside Development**, which is what you want for capturing SQL, needs the
connection string passed explicitly — user secrets are only loaded in the Development environment,
so `dotnet run --no-launch-profile` otherwise fails at startup with "No 'Freshline' connection string
is configured":

```bash
env "ConnectionStrings__Freshline=Server=localhost,1433;Database=Freshline;User Id=sa;Password=Freshline_Local_2026!;TrustServerCertificate=True" \
    "Logging__LogLevel__Microsoft.EntityFrameworkCore.Database.Command=Information" \
    "ASPNETCORE_URLS=http://127.0.0.1:5199" \
    dotnet run --project src/Freshline.Api --no-launch-profile
```

That logging switch is how every piece of SQL in `docs/performance.md` was captured. Read the
generated SQL rather than assuming what EF emits — it produced a `ROW_NUMBER` window where
`OUTER APPLY` was expected, and that difference turned out to matter in both directions.

**Two databases.** `Freshline` holds the ingested data and is what the measurements run against.
`Freshline_ApiTests` is dropped and recreated by `ApiFixture` on every test run — never point the
tests at the first one.

---

## Verified state of the data

Counts taken from the live database on **2026-07-26** with `count(*)`, not recalled. Anything not
listed here was not measured.

| | |
|---|---|
| Establishments | 23,528 |
| — with coordinates | 23,017 |
| — awaiting first inspection | 3,605 |
| Inspections | 29,601 |
| Violations | 94,400 |
| Source records | 99,050 |
| Distinct cuisines | 89 |
| Migrations applied | 4 |
| Inspection date range | 2025-07-25 → 2026-07-23 |

**Grades:** A 13,876 · B 1,039 · C 545 · N 1,638 · Z 1,037 · P 108 · **null 11,358**

**Localities:** Manhattan 9,239 · Brooklyn 6,042 · Queens 5,303 · Bronx 1,979 · Staten Island 899 ·
null 66

**Name collisions**, which is why a keyset cursor cannot sort on name alone: 1,507 name groups hold
more than one establishment, 6,546 establishments share a name with another, and `DUNKIN` appears
**307** times.

**Nesting bounds**, which is why the detail query is a single query rather than `AsSplitQuery`: at
most 9 inspections per establishment, at most 18 violations per inspection, 0 duplicate
`(InspectionId, Code)` groups, and 1,045 inspections citing no violations.

**Indexes on `Establishments` before M4:** the clustered primary key,
`IX_Establishments_SourceRecordId`, `UX_Establishments_SourceId_ExternalId`, and the spatial
`SX_Establishments_Location`. **Nothing on `Name`, `Cuisine`, or `Locality`.**

---

## Standing requirements

Not specific to M4. Repeated here because a milestone brief that omits them reads as if they were
optional.

- **Explain what was rejected and why, as the work happens.** If it cannot be narrated in an
  interview it has failed its purpose — this project exists so it can be explained, not just exist.
- **No invented numbers anywhere.** Not in the README, not in commit messages, not in the log.
  "Unknown" is fine; a plausible guess is not.
- **Verify before asserting.** Anything factual about the data is checked against the database or the
  API, not recalled. ADR-0002 was written from recollection and was partly wrong; that is the failure
  mode this project is calibrated against.
- **Auth logic and every EF Core migration get line-by-line review before merge.** Flagged
  explicitly, not buried in a diff.
- **A dependency addition is a decision.** Name it, what it buys, and what it drags in transitively.
- **Conventional commits. Branch and PR, CI green before merge. Never push to `main`.**

---

## Open items created by M4

- **The rate limiter partitions on `RemoteIpAddress`, which will be the proxy's the moment one
  exists.** Behind a reverse proxy, CDN or Azure ingress every caller collapses into one bucket and a
  per-client limit silently becomes a global one that locks everybody out together. The fix is
  `UseForwardedHeaders` with `KnownProxies` or `KnownNetworks` populated with that proxy's actual
  addresses — and only that way round, because trusting `X-Forwarded-For` from anywhere is worse than
  ignoring it: the header is caller-supplied, so an attacker mints a fresh bucket per request and
  turns the limiter off for precisely the caller it exists to stop. Those addresses are a property of
  a deployment that does not exist yet, so this is **M5 work and a deploy-time blocker**, not a
  cleanup.
- **The limiter is per-instance.** It lives in one process's memory, so two instances behind a load
  balancer permit twice the configured rate. Acceptable at M5's expected scale and stated so nobody
  reads the configured number as a system-wide guarantee.
- **The rate limits have never been load tested.** They bound one caller against a number nobody
  measured. See the slice 5 notes above.

## Open items carried into M4

Inherited, not created here, and none of them block the milestone.

- The **30-day lookback window** is an unmeasured assumption from M1.
- There is **no cold-cache performance measurement**. Every number in `performance.md` is warm-cache
  from a single-user laptop container.
- **Branch protection is not enabled server-side.** `.githooks/pre-push` is a local stand-in and
  `--no-verify` bypasses it.
- **The Chicago-side claims in ADR-0002 are permanently unverified** now that M2 is cut.
