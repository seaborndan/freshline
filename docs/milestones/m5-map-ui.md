# M5 — Map UI

The working brief for the milestone. Scope, constraints, and the decisions taken before any code was
written, kept so the reasoning survives the sitting it was decided in.

Roadmap entry: [M5](../roadmap.md). Decisions that outlive the milestone graduate to an ADR; this
file is the scope fence, not the decision record.

**Done when:** someone can open the live URL, filter to an area, click a place, and understand what
they are looking at without being told.

> **This is the showable bar.** The roadmap says the URL goes on the résumé the day this deploys.
> That single sentence decides most of the trade-offs below: when something is a choice between
> *correct* and *impressive*, correct wins, but when it is a choice between *finished* and
> *thorough*, finished wins. A half-built map behind a login is worth nothing here.

---

## Deliverables

- Establishments as clickable points on a map, coloured by status, with a legend
- Filter panel — cuisine, borough, outcome, never-inspected
- Detail panel with inspection history
- Loading, error, and empty states
- Keyboard navigation
- Deployed and reachable at a URL

---

## Scope fence

**One source, one city, read-only.** No login, no signup, no user accounts, no saved territories —
those are M6 and they need an issuer that does not exist. Nothing in this milestone writes.

The test, inherited from M4: *if something being built implies multiple sources, or implies identity,
that is a signal to re-read the scope, not to widen it.*

---

## What already exists, and what it costs

`maplibre-gl@^6.0.0`, React 19, TypeScript, Vite 8, Vitest 4 and Testing Library are **already in
`web/package.json`**. The map library is not a dependency decision to be taken — it was taken at M0.

`web/src` is still the Vite starter: `App.tsx`, `App.test.tsx`, `main.tsx`, and a `hero.png`. One
Vitest test passes. Everything in this milestone is new code, not modified code.

**A new package is a decision** (CLAUDE.md). A state manager, a data-fetching library, a component
library and a CSS framework are each the kind of thing that gets added reflexively at the start of a
front end. Each needs naming, justifying, and its transitive cost stated — or not adding.

---

## The API contract, as it actually shipped

Read from the source of truth, not recalled. Base path `/api/v1`. Full document at `/openapi/v1.json`,
browsable at `/scalar/v1`.

| Endpoint | Returns |
|---|---|
| `GET /establishments` | `{ items: [], nextCursor: string \| null }` |
| `GET /establishments/map` | `{ items: [], isTruncated: bool }` |
| `GET /establishments/{id}` | One establishment with full inspection history |
| `GET /me` | Token claims. **Not used by this milestone.** |

Shared filter query parameters on both list and map: `nameStartsWith`, `cuisine`, `locality`,
`outcome`, `awaitingFirstInspection`. List also takes `cursor` and `pageSize` (1–200, default 50).
Map also takes `minLat`, `maxLat`, `minLon`, `maxLon` — **all four required** — and `limit`
(1–5,000, default 1,000).

A map pin is:

```ts
{ id, name, latitude, longitude, isAwaitingFirstInspection, latestInspection }
```

and `latestInspection`, when it is not null, is:

```ts
{ inspectedOn, rawGrade, outcome, normalisedSeverity, closedByAuthority }
```

Things about this contract that will bite if assumed rather than read:

- **`latitude` and `longitude` are never null on the map endpoint** and nullable everywhere else. The
  viewport query excludes establishments without coordinates, because they cannot be drawn — 511 of
  23,528. They remain reachable through the list and detail endpoints.
- **`latestInspection` is null for an establishment never inspected**, which is a state to render,
  not an error. It is a different fact from `rawGrade: null`, and the UI must not collapse them.
- **There is no total count and no page number, anywhere, by design.** A caller pages until
  `nextCursor` is null. A "showing 1–50 of N" control cannot be built without a new endpoint, and
  adding one is a decision, not an implementation detail.
- **The map is not paged and reports `isTruncated`.** When true the correct response is to tell the
  user to zoom, not to try to fetch the rest. Which rows were dropped is arbitrary — primary-key
  order, correlating with nothing a user cares about.
- **Nulls are serialised, not omitted**, so a field is never absent.
- **Invalid input is refused, not corrected.** `pageSize=5000` is a `400` with `ProblemDetails`, not
  a silent clamp. Every failure is `ProblemDetails` — including the `429` from the rate limiter,
  which is a normal response to design for rather than an exceptional one.

---

## Decisions taken before implementation

### The map is anonymous and sends no token

Settled at M4 and recorded in [ADR-0005](../adr/0005-public-read-surface-and-token-validation.md).
The front end has no login, no auth state, no token storage and no `Authorization` header. `/me`
exists and this milestone does not call it.

Consequence worth stating so it is not rediscovered: there is no 401 path to design for.

### Colour by `outcome`, not by `rawGrade`

`rawGrade` is NYC's vocabulary — six values, `A B C N Z P`, and null more often than not. `outcome`
is the normalised scale the whole system is built on, and it is the field that would still mean
something if a second city ever arrived.

**They are different sizes and that is the trap.** Six raw grades, five outcomes. See the
distribution below before designing the legend.

### The viewport drives the query

The map endpoint takes a bounding box, so the natural loop is: user pans or zooms → read the new
bounds off the map → request → replace the pins. Filters are query parameters on the same request,
so a filter change is the same code path as a pan.

This needs debouncing. A drag fires bounds-changed continuously, and one request per frame would
exhaust the rate-limit bucket in seconds — see the numbers below.

### Tests query by role and visible text

Not by test id, not by class name. Inherited from CLAUDE.md and repeated because a map is the most
tempting place in this project to reach for a test id.

### Decisions still to take, at the start of the session

Take these before code, the way M4 took the public-map decision before code, rather than letting an
implementation imply them:

- **How the list and the map relate.** Is the side panel the same data as the pins, a paged list of
  the same viewport, or an independent search? They are different endpoints with different semantics
  and the choice changes the whole component tree.
- **What happens on `isTruncated`.** A banner, a disabled state, or a forced zoom.
- **Whether filters live in the URL.** A shareable link to a filtered viewport is worth a lot for a
  résumé URL and costs a router or hand-rolled query-string sync. A router is a dependency decision.
- **What "understand what they are looking at without being told" means concretely**, since it is the
  acceptance criterion. Probably: the legend explains every colour on screen, including the two that
  are not grades.

---

## Correctness traps

Each of these throws nothing when you get it wrong.

- **MapLibre takes `[longitude, latitude]`.** This is the *third* coordinate-order convention in this
  project and it disagrees with T-SQL's: NetTopologySuite `Point` is `(X, Y)` — longitude first; the
  API returns named `latitude` / `longitude` fields specifically so the order cannot be got wrong in
  transit; and `geography::Point` in T-SQL takes latitude first. A swap throws nothing and puts every
  restaurant in the Southern Ocean. See ADR-0004.
- **`outcome` is serialised as a name, not a number** — `"Good"`, not `1`. Deliberate, so reordering
  the enum cannot silently change meaning. Do not write a numeric switch.
- **`Ungraded` is not "no data".** It is a published state and the second-largest group on the map.
- **`closedByAuthority` is a separate boolean, not an outcome.** An establishment can be closed with
  any grade. If the map needs to show closures, that is a sixth visual state, not a sixth colour on
  the outcome scale.
- **`inspectedOn` is a date, not a timestamp** — `"2026-06-01"`. Passing it to `new Date()` parses it
  as UTC midnight, which renders as the previous day in every timezone west of Greenwich. This is a
  real off-by-one-day bug, not a theoretical one, for a New York dataset viewed from New York.
- **The rate limiter is real and applies to this client.** 60 burst, 30 per 10 seconds per IP. It is
  not disabled in development.

---

## Verified state of the data

Counted from the live database on **2026-07-26**, not recalled. Anything not listed was not measured.

**Establishments by the outcome of their most recent inspection** — this is what the map colours, and
it is the distribution the legend has to serve:

| Latest outcome | Establishments | With coordinates (drawable) |
|---|---|---|
| `Good` | 12,861 | 12,648 |
| `Ungraded` | 6,283 | 6,198 |
| **never inspected** (`latestInspection: null`) | **3,605** | 3,399 |
| `Fair` | 686 | 679 |
| `Poor` | 93 | 93 |
| `PendingReinspection` | **0** | 0 |
| **Total** | **23,528** | **23,017** |

Three things follow, and they are the reason this table is here:

1. **A legend built around A/B/C mis-serves 42% of the map.** `Ungraded` plus never-inspected is
   9,888 establishments — 9,597 of the drawable ones. Both need a colour and an explanation, and
   neither is a grade.
2. **`PendingReinspection` never appears as a latest outcome**, though 108 inspections carry it
   historically. The enum value is reachable and today no pin will ever use it, so it cannot be
   checked by looking at the map. Handle it; do not expect to see it.
3. **`Poor` is 93 establishments — 0.4%.** The most interesting tier for the product is nearly
   invisible at city zoom. Whatever renders it has to survive being rare.

**Establishments closed by authority at their latest inspection: 62.**

**Distinct cuisines: 89.** A flat dropdown of 89 items is a usability decision, not a given.

**Localities:** Manhattan 9,239 · Brooklyn 6,042 · Queens 5,303 · Bronx 1,979 · Staten Island 899 ·
null 66. **The 66 nulls are real** and will not match any borough filter.

**Inspection date range:** 2025-07-25 → 2026-07-23. **At most 9 inspections per establishment**, so a
detail panel's history list is short and does not need virtualising.

**All establishments fall inside 0.41° of latitude by 0.55° of longitude.** The API rejects a viewport
larger than 1.0° on either axis with a `400`, so a fully zoomed-out world map is an error, not an
empty result. The initial viewport has to be set deliberately.

---

## Running both halves together

```bash
docker compose up -d --wait
dotnet run --project src/Freshline.Api        # http://localhost:5045
cd web && npm run dev                         # http://localhost:5173
```

`http://localhost:5173` and `http://127.0.0.1:5173` are **already allowed by the API's CORS policy in
Development**, from a committed default in `CrossOriginPolicy` — not from `appsettings.Development.json`,
which is gitignored. So direct calls from the dev server work with no proxy. A Vite proxy is still an
option and is a decision: it removes CORS from the picture in development and hides a class of bug
that will reappear in production.

See [`docs/local-development.md`](../local-development.md) for the rest of the setup.

---

## Slices

Documentation for each slice is written **as part of that slice**, not deferred.

| # | Slice | Status |
|---|---|---|
| 1 | API client and generated types, error and 429 handling | not started |
| 2 | Map with pins, coloured by outcome, with a legend | not started |
| 3 | Viewport-driven fetching, debounced, with truncation handling | not started |
| 4 | Filter panel | not started |
| 5 | Detail panel with inspection history | not started |
| 6 | Loading, error, empty states and keyboard navigation | not started |
| 7 | Deployment, and the URL | not started |
| 8 | Consolidation — ADR, README, roadmap, log | not started |

**Needs line-by-line human review before merge:** any new dependency, and anything touching
deployment configuration or secrets.

---

## Standing requirements

Not specific to M5. Repeated because a milestone brief that omits them reads as if they were optional.

- **Explain what was rejected and why, as the work happens.** If it cannot be narrated in an interview
  it has failed its purpose.
- **No invented numbers anywhere.** "Unknown" is fine; a plausible guess is not.
- **Verify before asserting.** Anything factual about the data is checked against the database or the
  API, not recalled.
- **A dependency addition is a decision.** Name it, what it buys, and what it drags in transitively.
- **Front-end tests query by role and visible text.** Coverage is a diagnostic, never a target.
- **Conventional commits. Branch and PR, CI green before merge. Never push to `main`.**

---

## Open items carried into M5

- **The rate limiter partitions on `RemoteIpAddress`, which becomes the proxy's address behind any
  ingress.** Every caller then shares one bucket and a per-client limit becomes a global one that
  locks everybody out together. The fix is `UseForwardedHeaders` with `KnownProxies` or
  `KnownNetworks` populated with that proxy's real addresses — and only that way round, because
  `X-Forwarded-For` is caller-supplied. **This is a deploy-time blocker for slice 7**, not a cleanup.
- **The API's CORS policy has no production origin configured**, and cannot have one until the front
  end has a deployed URL. Slice 7 work, and the failure mode is a browser console error rather than
  anything server-side.
- **The rate limits are chosen, not load tested.** A real client panning a map is the first thing that
  will exercise them.
- **The `outcome` filter is unmeasured** and is the one most likely to be slow. M5 is the milestone
  that will actually use it.
- **No cold-cache performance measurement exists**, and every figure in `docs/performance.md` is
  warm-cache from a single unconstrained workstation.
- **Branch protection is not enabled server-side.** `.githooks/pre-push` is a local stand-in.
- **The 30-day ingestion lookback** remains an unmeasured assumption from M1.
