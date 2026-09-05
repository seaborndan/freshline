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

### The list is a second rendering of the map response, not a second query

Taken at the start of the session, with the other three below.

**`GET /establishments` takes no bounding box.** Read from `EstablishmentEndpoints.ListAsync`, not
recalled: its parameters are the five filters plus `cursor` and `pageSize`. "A paged list of the same
viewport" is therefore not one of the available options — it needs a new endpoint, which the contract
section above already names as a decision rather than an implementation detail. That is not being
taken for a side panel.

So the side panel renders **the same `items` the pins are drawn from**, held once and displayed
twice. One request per viewport change, one source of truth, and selection state that cannot
disagree between the two halves.

The alternative that was live: the panel as an **independent name search** over the list endpoint,
city-wide and cursor-paged. Rejected because it makes the panel a different question from the map —
a row could refer to an establishment nowhere near the screen, and clicking it either teleports the
map or does nothing, both of which have to be explained to a user. It also spends a second
rate-limit budget on every keystroke.

Consequences, stated rather than discovered later:

- **The 511 establishments with no coordinates are unreachable in this UI.** They are excluded from
  the map endpoint because they cannot be drawn, and nothing else queries. They stay reachable
  through the API. This is the honest cost of the decision and it belongs in the README, not in a
  silent gap.
- **The panel inherits the map's truncation**, which is what makes the banner below coherent: one
  response, one caveat, shown in both places.
- **The panel does not render a thousand rows.** The viewport response can hold up to `limit` items
  and re-renders on every pan. It renders a bounded window of them in name order — the list
  endpoint's ordering, so the two agree — above a line saying how many are in view. Virtualising a
  list nobody has scrolled is a dependency and a complication bought before it is needed.
- **Sorting happens on the client**, over at most `limit` items already in memory. The map endpoint
  returns primary-key order, which the response's own documentation calls arbitrary.

### `isTruncated` is a banner, and it disables aggregates

Not a forced zoom: moving a user's map for them is hostile, and a zoom that re-queries and truncates
again is a loop. Not a disabled state either — the pins that came back are real, correctly placed,
and worth drawing.

A persistent, non-blocking banner above the list and the map: this viewport holds more than can be
shown, zoom in or filter to narrow it. Both halves are already fed by one response, so it is one
message in one place.

**The part that is not cosmetic:** while `isTruncated` is true, nothing on screen may state a number
derived from the response. Which rows were dropped is arbitrary — primary-key order, correlating with
nothing — so "12 Poor in this area" would be a fabricated statistic wearing the clothes of a measured
one, which is exactly what the no-invented-numbers rule exists to stop. Counts render as "at least
N", or not at all.

**This makes the initial viewport a real decision, not a default.** 23,017 drawable establishments
against a limit of 1,000 means a whole-city first paint is truncated, so the first thing a stranger
sees is a caveat. The initial viewport is therefore a committed constant, chosen in slice 3 by
querying the API for a candidate box and checking `isTruncated` — not picked by eye and not left to
whatever MapLibre defaults to. The requested `limit` is likewise sent explicitly and chosen by
measurement, not inherited from the server default.

### Filters and viewport live in the URL, synced by hand — no router

A shareable link is most of what makes this a résumé URL rather than a demo: a filtered viewport that
survives being pasted into an email is the difference between showing the map and describing it.

**No router.** React Router would be added for zero routes — there is one page, no route matching, no
nested layouts, no data loaders wanted — and it brings its own history abstraction to wrap the one
browser API actually being used. `URLSearchParams` and `history.replaceState` are that API, they are
in every browser this targets, and they are two lines each.

`replaceState`, never `pushState`: a map that pushes a history entry per pan turns the back button
into an undo-my-panning key and traps the user on the page. Sharing needs the address bar to be
correct, which `replaceState` gives; it does not need every intermediate viewport to be a document in
the session history.

What is in the query string: the five filters, plus centre and zoom rounded to fixed precision.
Centre and zoom rather than the bounding box, because the box is a function of the browser window —
the same box on a phone and a laptop frames different amounts of city, while a centre and a zoom
reopen the same place. The map's *query* is still the box it reads off itself after restoring.

**This is the part that changes the component tree**, which is why it is decided here. The URL is the
single source of truth for filter and viewport state. The filter panel therefore holds no state of
its own — it reads the current values and requests changes, and one owner above both panel and map
reconciles, writes the URL, and drives the fetch. A panel with its own `useState` mirrored into the
URL is two sources of truth that will disagree on the first shared link opened.

**Values arriving from the URL are validated, not trusted.** `?outcome=Banana` is a user-editable
string on its way to an API that answers a bad enum with a `400`. Unknown filter values are dropped
on read and the rest of the URL is still honoured; a viewport that fails the API's own rules — larger
than one degree, inverted, off the world — falls back to the committed initial viewport rather than
rendering an error page to someone who followed a link.

### "Understand without being told" means these seven things

The acceptance criterion is prose, so it is written down as checks that can fail. All are testable by
role and visible text.

1. **The legend carries all five outcomes, plus never-inspected**, and is static rather than derived
   from what happens to be on screen. Deriving it would drop `Poor` — 0.4% of the data — out of the
   legend at most viewports, and would leave `PendingReinspection` as an unexplained colour the day
   one appears. A legend that changes while panning also stops being a key and becomes a readout.
2. **Every legend entry is a phrase, not a label.** "Ungraded — inspected, no grade published" and
   "Never inspected — holds a permit, not yet visited" are the two that carry 42% of the map, and the
   word alone does not distinguish them from each other or from missing data.
3. **`closedByAuthority` is a visual modifier, not a colour** — an outline or ring on the pin, listed
   in the legend as a modifier. It is orthogonal to outcome: 62 establishments, any grade.
4. **`rawGrade` is shown where it is recognisable and never used to colour anything.** The letter in
   the window is what a user recognises; the outcome is what the scale means. The detail panel shows
   both, and the two never contradict because only one of them drives pixels.
5. **Dates are rendered from the string, not through `new Date()`.** `"2026-06-01"` parsed as a
   Date is UTC midnight and renders as 31 May in New York.
6. **No number on screen comes from a truncated response**, per the decision above.
7. **Empty is not error.** A valid viewport with no matches says so in words, distinct from a failed
   request and distinct from a load in progress. Filter combinations make this reachable on purpose:
   an `outcome` filter excludes never-inspected establishments by definition, so combining it with
   "awaiting first inspection" is a guaranteed empty result and the panel must not offer it as though
   it might return something.

### No new dependencies, and what was turned down

The verdict for the whole milestone, taken here so it is not re-litigated per slice. Every candidate
below is the kind of package that gets added reflexively at the start of a front end.

- **A router** — rejected above. Zero routes.
- **A data-fetching library** (TanStack Query). Buys caching, deduplication and retry across many
  endpoints; this milestone has one request in flight at a time, whose correct behaviour on a new
  viewport is *cancel the old one*, which is an `AbortController` in an effect. Retry is wrong here
  anyway: the failure to design for is the `429`, and retrying it is how a client turns a throttle
  into an outage.
- **A state manager** (Zustand, Redux). The URL is the source of truth and there is one owner
  reconciling it. A store would be a second place for the same state to live.
- **A CSS framework or component library** (Tailwind, MUI). Changes the build and the review surface,
  ships a design system nobody asked for, and none of it is explainable as the author's own work.
- **A virtualised list** (TanStack Virtual, react-window). Bought before the bounded window above is
  measured to be insufficient.
- **OpenAPI codegen** (`openapi-typescript`) — the closest call, and the reason slice 1 is worded
  "generated types". Buys types that cannot drift from the shipped contract. Turned down because the
  surface is four response shapes and roughly twenty fields; the generated file would describe
  endpoints this UI never calls, would be committed code the author did not write, and codegen run by
  hand drifts the moment nobody runs it. **What replaces it is stronger than types:** the client
  parses and validates at the boundary, so an `outcome` outside the known set, or a pin missing a
  coordinate, fails loudly at the point of arrival. TypeScript types are erased at runtime and would
  not have caught either.

Anything reconsidered later is a decision recorded here, not a line added to `package.json` in the
middle of a slice.

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
which is gitignored. So direct calls from the dev server work with no proxy.

**Decided in slice 1: no Vite proxy.** It was the more comfortable option — one origin, CORS gone
from development entirely — and that is the objection to it. CORS is a production condition, and a
proxy means the first time anyone meets it is on the deployed URL, as a browser console error, with a
different tool chain to debug it in. The direct arrangement costs nothing here and exercises the real
path on every request. The base URL is `VITE_API_BASE_URL`, defaulting to the `dotnet run` address;
slice 7 sets it at build time.

The API must therefore be running for the front end to show anything, which is the honest dependency
rather than a hidden one.

See [`docs/local-development.md`](../local-development.md) for the rest of the setup.

---

## Slices

Documentation for each slice is written **as part of that slice**, not deferred.

| # | Slice | Status |
|---|---|---|
| 1 | API client and types, error and 429 handling | **done** |
| 2 | Map with pins, coloured by outcome, with a legend | **done** |
| 3 | Viewport-driven fetching, debounced, with truncation handling | **done** |
| 4 | Filter panel | **done** |
| 5 | Detail panel with inspection history | **done** |
| 6 | Loading, error, empty states and keyboard navigation | **done** |
| 7 | Deployment, and the URL | **in progress** — repository is deployable; no Azure resource exists yet |
| 8 | Consolidation — ADR, README, roadmap, log | **done** — ADR-0006, log entry, roadmap status, README |

**Needs line-by-line human review before merge:** any new dependency, and anything touching
deployment configuration or secrets.

### Slice 1, as built

`web/src/api/` — `contract.ts` (the types), `validate.ts` (the boundary), `client.ts` (the only
`fetch` in the application), `errors.ts`, `viewport.ts`, `plainDate.ts`. No new dependencies. The
slice is renamed from "generated types" because codegen was turned down; see the dependency decision
above.

Three things in it are worth being able to defend, because each replaces something a reviewer would
expect to find:

- **The boundary check earns its place by catching what types cannot.** An unknown `outcome` is
  rejected by name, and a numeric one — `1` instead of `"Good"` — is rejected as a wrong type. Both
  compile fine and both would draw a wrong colour on a real restaurant.
- **A swapped axis is caught by containment, not by range.** New York is near 40.7°N, -74.0°E, and
  each of those is a legal value for the other axis, so a swap lands in the Indian Ocean looking
  entirely plausible. Range-checking cannot see it. Being outside the rectangle that was requested
  can, and one swap in the query builder puts every pin outside it at once.
- **Nothing retries, including the 429.** `Retry-After` is read and surfaced so the UI can say when
  to come back. A client that retries a throttle is how a rate limit becomes an outage.

Fixtures in `__fixtures__/` are captured from the running API, not transcribed from the C# records —
including the 429, whose body has no `type` member while the 400's does. A hand-written fixture would
have had one.

**Verified, not assumed.** 49 web tests pass. The two checks the slice exists for were
mutation-tested — the containment guard and the outcome guard were each broken deliberately, and
exactly the test naming them failed. The client was then run once against the live API: 5,000 pins
validated end to end (`Good` 2,387 · `Ungraded` 2,014 · never inspected 305 · `Fair` 251 · `Poor` 43,
`isTruncated` true), the `outcome` filter combined with `locality` returned 7 `Poor` in the Bronx, a
detail request returned its history, and a 404 surfaced the API's own sentence.

That truncated whole-city response is the measurement behind the initial-viewport decision: at the
maximum limit the API allows, the city does not fit.

### Slice 2, as built

`web/src/map/` — `pinStyle.ts` (the one table the layer and the legend are both generated from),
`geoJson.ts`, `layers.ts`, `initialView.ts`, `MapView.tsx`, `Legend.tsx`. No new npm dependencies.

**The good end of the scale is blue, not green, and that was measured.** Green-amber-red was tried
first. Status green against status red measures **ΔE 4.1 under deuteranopia** — so the two colours
carrying "best restaurant here" and "worst restaurant here" are the pair the most common
colour-vision deficiency cannot separate, on a map where colour is the entire message. The shipped
scale measures **ΔE 9.1 at its worst pair under deuteranopia and 16.3 under normal vision**, checked
across all pairs rather than adjacent ones because any two pins can end up beside each other.
Severity is additionally carried by **size** — worse is bigger — which doubles as the fix for `Poor`
being 0.4% of the data and nearly invisible at city zoom.

Two validator checks are deliberately not met, recorded rather than worked around: the grey for
`Ungraded` fails a chroma floor because it "reads gray", which is the intended meaning of *no grade
was published*; and the amber for `Fair` sits below 3:1 contrast, which is documented as by-design
for a warning step and is mitigated by the visible label the legend always shows.

**Closure is a ring, never a colour**, because an establishment can be closed at any grade — giving
it a hue would overwrite the grade it actually has. **Never-inspected is hollow**, so it differs from
`Ungraded` by shape as well as fill; they are the two largest non-grades and the pair most likely to
be collapsed into "no data".

**Update, 5 September 2026:** CARTO now requires a basemap API key. Freshline supplies it through
`VITE_CARTO_BASEMAP_API_KEY` in ignored local configuration. See [local development](../local-development.md#web-app-and-carto-basemap-key)
for registration, watermark troubleshooting, and CARTO's raster retirement notice. The hybrid
raster/vector rendering described below is still in use.

**The basemap is CARTO Positron**, from `basemaps.cartocdn.com`, now authenticated by API key. Named as a runtime
dependency on a third party: if that CDN is down the pins draw on a blank background and the page
still works. Greyscale by design, so the data on top of it can have the colour. The original
selection favored CARTO's then-keyless access over providers requiring keys. That rationale is
now obsolete: browser-visible keys can be configured outside Git, as Freshline now does.

**Three bugs were found by running the app. The first two could not have been found by a test;
the third was actively hidden by one.**

1. **Vite's dependency pre-bundler broke MapLibre's worker.** It rewrites the `new Worker(new URL(…))`
   call to a file it then does not emit, so on the dev server the worker never starts and the map
   never finishes loading — silently, with the rest of the page working normally. Fixed with
   `optimizeDeps: { exclude: ['maplibre-gl'] }`.
2. **The radius expression was invalid and took the whole pin layer down with it.** Writing it as
   `['*', interpolateOnZoom, matchOnState]` reads naturally and is illegal: MapLibre allows `['zoom']`
   only at the top level of a paint property. `addLayer` was rejected, and the result was a basemap
   with no pins on it. Found because the map surfaces its own errors on screen — an error handler
   added while chasing the first bug, and worth keeping: a blank canvas is otherwise
   indistinguishable from an area with no restaurants in it.

3. **The pins were added from an empty array, and the test suite said otherwise.** The map is built
   once, so its handlers close over the props of the first render — where there are no pins yet,
   because the request has not returned. Whether that matters is a race between a style download of
   several hundred kilobytes and an API that answers in tens of milliseconds, and the data wins every
   time: the source was created empty and stayed empty. **The test double fired `style.load`
   synchronously inside `render`** — the one ordering a browser cannot produce — so the suite was
   green while the map was blank. Fixed by reading the pins from a ref; `MapView.test.tsx` now
   drives both orderings explicitly and never fires an event by itself.

**Verified.** 81 web tests pass, `tsc -b`, `vite build` and lint clean. The race fix was
mutation-tested: reverting it fails exactly the test written for it. The initial viewport and its
outcome mix were re-measured against the committed bounds rather than the ones the sweep used — 518
establishments, not the 517 first written down.

**Confirmed by eye, in a browser, because nothing here could confirm it otherwise.** Headless
Chromium on this machine will not rasterise a WebGL canvas — screenshots come back blank, the drawing
buffer reads all black, and because the render loop never runs the map never requests tiles, which
makes `queryRenderedFeatures` return zero no matter what is correct. Probes through that path
produced a reading of "223 pins painted" that was not measuring what it appeared to measure, and it
has been removed rather than left in as a plausible number. What is verified: the GeoJSON source
holds 518 features, both layers are added, and a person looking at the running app sees a few hundred
dots over the streets.

**The dot count is not the establishment count, and the caption used to imply it was.** 518
establishments in the opening viewport occupy **306 distinct points**; 75 points carry more than one
and a single address on Broadway carries **49**. They draw exactly on top of each other, so 212 pins
are invisible. The page said "518 places" over about three hundred dots, which invites a reader to
count them and conclude the map is broken — found by a reader doing exactly that. Both numbers are
now stated.

---

### Slice 3, as built

`useEstablishments.ts` owns the fetching policy, `viewportOf.ts` reads the box off the map, and `App`
is the one place that reconciles the two. The map reports where it is and holds no state of its own —
the structure decision 3 needs when filters and the URL arrive in slice 4.

**Four rules, each of which exists because of a specific way this goes wrong:**

1. **Debounce, on top of `moveend`.** `moveend` already collapses a drag into one event; the debounce
   collapses runs of discrete gestures, like wheel-zoom steps.
2. **Cancel the superseded request.** Its answer describes a box nobody is looking at, and without
   cancellation a slow response can arrive after a fast one and overwrite newer pins with older ones.
3. **Never ask the same question twice.** Compared on the rounded coordinates that go on the wire, so
   a click that does not move the camera costs nothing.
4. **Never send a viewport the API will refuse.** Zoomed out past a degree the answer is a `400`, and
   the whole dataset spans 0.41° by 0.55°, so that is a user who has zoomed past the entire city. It
   is said as an instruction — "zoom in to load establishments" — because nothing has gone wrong.

**Why 400 milliseconds.** Read from `PublicApiRateLimiting`: a token bucket of **60**, refilling **30
every 10 seconds** — three per second sustained — with `QueueLimit = 0`, so an over-limit request is
refused rather than delayed. It is **one bucket for every data endpoint** (ADR-0005), so the map
shares its allowance with every detail request slice 5 will make. 400ms caps a user who does nothing
but wiggle the map at 2.5 requests per second, under the sustained refill and leaving room for the
detail panel, while staying short enough to read as the request taking a moment rather than the
interface being slow.

**A 429 starts a cooldown rather than a retry.** Nothing retries — that rule stands. What the hook
does is decline to *send* until the limiter would accept it, so a user panning through a cooldown
collects one refusal instead of a dozen. The request that eventually goes is the one their last
movement asked for.

**Pins are never cleared while the next viewport loads.** An empty map is indistinguishable from an
area with nothing in it; stale pins about to be replaced are the better lie for a few hundred
milliseconds.

#### The initial viewport was wrong, and only the running app could say so

Slice 2 chose a box holding 518 establishments specifically so the opening view would not truncate.
It truncated anyway. **`fitBounds` fits the committed box *inside* the window**, so the box on screen
is larger on whichever axis has room to spare, and it is the on-screen box that gets fetched. The
nearly-square box became 0.0216° wide on a 1440×900 window and the fetch returned **1,019** — nineteen
over the limit. Every number in slice 2's candidate table was correct; none of them described what a
browser would ask for.

The box is now shaped like a window rather than a square — a longitude span about 2.5× the latitude
span, because a degree of longitude covers about 76% of the ground a degree of latitude does here. It
holds 369, and a real browser at 1440×900 fetches **424 places at 282 points**, untruncated, with a
margin that survives a window twice as wide (782). Keeping the two `Poor` in view cost a deliberate
nudge north: at 0.4% of the data, an opening view without one shows a legend row nothing on screen
demonstrates.

**Verified.** 100 web tests, `tsc -b`, build and lint clean. All four fetching rules were
mutation-tested — each was broken deliberately and failed exactly the tests naming it, and nothing
else. The opening view was confirmed end to end against the running API by reading the status line
the app renders.

### Slice 4, as built

`filters/FilterPanel.tsx`, `filters/useFilterOptions.ts`, `state/urlState.ts`, and one new API
endpoint. The panel holds no state of its own — every value comes from the URL through `App`, which
is the structure decision 3 required.

#### A new endpoint, taken as a decision

**The cuisine filter could not be built without one.** A client cannot discover the 89 values: a map
pin does not carry a cuisine, and the list endpoint returns one page's worth rather than the
vocabulary. The three options were to ask, to hard-code, or to drop the filter. Hard-coding puts one
city's source vocabulary in a front end and drifts silently the first time ingestion meets a new
value — the same objection that makes the canonical field `Locality` rather than `Borough`.

So `GET /api/v1/establishments/filter-options` returns the distinct cuisines and localities, ordered,
with nulls excluded because they are not selectable. It goes through the same seam as everything
else: a method on `IEstablishmentQueries` in Core, an EF implementation in Infrastructure, an
endpoint in Api. Five endpoint tests, including one asserting it answers without a token, because
ADR-0005 says the read surface must be defended against drift.

#### The two filter combinations that can only return nothing

- **`outcome` matches the latest inspection**, so an establishment with no inspections matches none.
- **`cuisine` is null for exactly the never-inspected establishments.** Verified as an exact
  correspondence in both directions against the live database — 3,605 rows, zero exceptions either
  way. NYC publishes no cuisine until somebody has been.

Nothing in the words "cuisine" and "never inspected" suggests they are mutually exclusive, so
choosing both would return an empty map with no explanation. When never-inspected is on, both
controls are disabled and the panel says why — disabled rather than hidden, because a control that
vanishes leaves a user wondering what they did while a sentence teaches them something true about the
data.

#### Movement is never interrupted to draw pins

Reported from a browser after slice 4: panning and rotating stutter while a request for the current
view is resolving, and go smooth again once it lands.

**The client's own work is not the cost.** Measured over synthetic payloads: validating a thousand
pins takes 1.5ms, turning them into GeoJSON 0.1ms, counting distinct points 0.2ms — about 2ms for the
whole pipeline, and 10ms even at the API's maximum of 5,000. The expense is what MapLibre does next:
`setData` re-tiles the source, and that work shares a worker pool with parsing the basemap tiles for
wherever the user is panning *into*.

So `setData` is never called while the camera is in motion. New pins are held and applied on the next
`moveend` — only the newest set, so three viewports resolving during one long drag do not become
three re-tilings the moment the user lets go. `isMoving()` rather than any single event name, because
it covers panning, zooming, rotating and the inertial glide after a flick.

**The trade this makes, stated plainly:** pins can be up to one gesture late. That is the trade the
map should make. A stutter while dragging is a much worse thing to be than a moment behind with the
dots, and unlike the dots it cannot be waited out.

Three smaller costs went with it, all of them work landing on frames a gesture needed: the legend and
the filter panel are memoised — the panel renders 102 `<option>` elements and its parent re-renders
on every pan — and the distinct-point count is recomputed only when the pins change rather than on
every loading flip.

It was not enough on its own. A second report: smooth at a viewport of 0.0376° by 0.0503°, jittery
any further out.

**The pins are not what changes.** That box and one three times its size both return exactly 1,000
establishments, because both truncate — measured, not assumed. What changes is the basemap. CARTO
Positron is 95 layers: 56 line layers and **27 symbol layers**. Symbol layers are the expensive ones
to move, because MapLibre recomputes label placement and collision on the main thread and re-runs it
on every rotation — and zoomed out over New York there are far more labels competing for space.

So the basemap's labels are restricted to zoom 14 and above, declaratively, by narrowing each symbol
layer's own zoom range at style load. Nothing runs per frame or per gesture: the alternative of
toggling visibility on `movestart` and `moveend` keeps labels everywhere but pays a re-layout of 27
layers twice per gesture, which is the same cost moved rather than removed. Symbol fading is off for
the same reason — a fade is an animation, so the map keeps re-rendering and re-placing labels after
the camera has stopped. World copies are off too, since the camera is locked to one city.

**The trade:** below zoom 14 there are no street names — roads, water and dots. That is close to what
an overview of a city is for, and the threshold is one named constant to move in either direction.

That was not enough either, and the third round is where the actual cause turned up. Two hypotheses
had already been killed by measurement — the pin count is identical either side of the boundary, and
the *number* of basemap layers is higher in the smooth zone than the jittery one (80 active at zoom
15 against 46 at zoom 12). What was left was the tiles themselves, measured against CARTO over
Manhattan:

| zoom | vector `.mvt` | raster `.png` @2x |
|---|---|---|
| 12 | 98KB | 30KB |
| 13 | 89KB | — |
| 14 | **389KB** | 26KB |
| 15+ | **HTTP 400 — does not exist** | — |

**CARTO's vector tiles stop at zoom 14.** Every zoom above it *overzooms*: MapLibre scales tiles it
has already parsed and parses nothing new. Below 14 it parses a few hundred kilobytes of fresh
geometry for every new area moved into, and the further out the camera is, the more new area each
gesture exposes. The reported boundary between smooth and jittery was exactly the boundary where
parsing stops — which is why no amount of removing layers helped.

So the basemap is now a hybrid, and the arrangement is the interesting part:

- **Geometry comes from raster tiles.** An image is decoded off the main thread and drawn as a
  texture; there is nothing to parse at any zoom. Positron's fills, lines and circles are removed at
  style load and one raster layer put underneath the labels.
- **Labels stay vector.** A raster basemap normally has its lettering baked into the picture, which
  rotates with the map and never rotates back — rotation was explicitly not up for sacrificing. Kept
  as symbol layers, MapLibre places them dynamically and they stay upright at any bearing.
- **And because MapLibre asks a source for tiles only when a visible layer needs them**, restricting
  those symbol layers to zoom 14 and up means no vector tile is fetched below 14 at all. The zooms
  that were jittery became pure raster; the zooms where labels appear were already the smooth ones.

Verified in a browser rather than reasoned about: at zoom 12, **0 visible vector layers**; at zoom
15, **12**. A first attempt at that measurement counted a hidden layer as active and had to be
redone — and an attempt to count tile requests through the Performance API was thrown out entirely,
because MapLibre fetches vector tiles inside its worker and worker requests never appear in
main-thread resource timing.

The cost, stated: two third-party endpoints instead of one, and a style assembled in this repository
rather than handed to MapLibre as a URL.

**Still available if it is still not enough:** fetching a box larger than the viewport, so small pans
need no request at all — that costs earlier truncation, which is the thing the opening view was
shaped to avoid.

#### The camera cannot leave New York

Raised from a browser: it is odd to be able to zoom out and see the whole world in a product scoped
to one city. Asked as a performance question, and the honest answer is that performance is the
weaker half of the argument.

**Zooming out costs the API nothing** — past one degree the client already declines to ask, so a
world view produces no requests at all. It is not free, though: the basemap keeps fetching and
parsing tiles for places this product will never describe, on the same worker pool that competes with
drawing the pins, which is the contention the smoothness fix above is about. The stronger reason is
the one that was actually noticed: a map of the Atlantic with no dots on it reads as a broken
product rather than as a product with a scope.

`maxBounds` is the measured data extent — latitude 40.499563 to 40.912822, longitude -74.249101 to
-73.701712 across 23,017 rows — plus 0.02° on each side so an establishment at the edge can be
centred rather than pinned against the frame. `minZoom` is 9.5.

Verified in a browser rather than assumed: jumping the camera to 0°, 0° at zoom 2 lands at
**40.596, -73.975 at zoom 10.73** — still New York, both constraints holding.

Zoomed fully out on a wide window the view still exceeds one degree and the page says "zoom in to
load establishments". No single value fixes that, because the span depends on the window's width: a
minimum zoom keeping an ultrawide monitor under a degree would stop a phone from seeing the city at
all. The one-degree guard remains the real backstop.

#### Decision 3, partly reversed

The URL carries the filters and the viewport, synced with `URLSearchParams` and `replaceState`, no
router — as decided. **The viewport is a bounding box rather than a centre and a zoom, which is the
opposite of what was decided**, and the reason is worth keeping:

The original argument was that a box is a function of the window, so the same box frames different
amounts of city on a phone and a laptop, while a centre and a zoom reopen the same place. That holds
for "look at this point" and is backwards for a product about areas. `fitBounds` guarantees a shared
box is *entirely visible* on whatever screen opens it — a phone shows that area and more. Centre and
zoom guarantee the opposite: the phone shows a fraction of what the sender saw, silently. The box
also removes a second camera representation from an application that already speaks in boxes
everywhere else.

**Verified.** 141 backend tests and 127 web tests, `tsc -b`, build and lint clean. Checked end to
end against the running API: a plain load reports 424 places at 282 points with 102 dropdown options
rendered (89 cuisines, 5 boroughs, 5 outcomes, three "Any" rows), and a shared link carrying
`outcome=Poor&locality=Manhattan` opens directly on 9 matching places. The API returns 8 for those
exact bounds — the browser's fitted box is slightly wider, which is the same mechanism documented on
`initialViewport` rather than a discrepancy.

### Slice 5, as built

`detail/DetailPanel.tsx` and `detail/useEstablishmentDetail.ts`, plus a click handler on the map and
one more parameter in the URL.

#### A click on a crowded point opens a list, not an establishment

The open item from slice 2, answered. New York geocodes many establishments to the same address:
**47 of the 238 points in the opening view carry more than one**, the busiest carries 18, and one
address in the city carries 49. They are drawn exactly on top of each other, so a click there is a
question with several answers.

Taking whichever feature MapLibre returned first would have answered it arbitrarily — silently, and
differently depending on how the source happened to tile. So one establishment opens a record and
several open their names, each with its own state beside it, because at a stacked point the dot's
colour belongs to whichever establishment was drawn last, which is to say nobody's.

Rejected: spreading pins apart on click, which is a lot of machinery and draws restaurants where they
are not; and a cluster count, which answers "how many" when the question is "which".

The candidates come from the pins already on screen rather than from a second request — the map
response carried a name and a state for each, and re-asking would spend rate-limit tokens
re-learning what is in memory.

#### Details worth defending

- **Dates are rendered from the string.** `"2026-03-09"` through `new Date()` is UTC midnight, which
  is the 8th in New York, and there is a test asserting the 9th appears and the 8th does not.
- **Never inspected is described as a published state**, not as missing data — it is the
  third-largest group on the map and the panel says so in words.
- **Closure is separate from the grade.** The fixture establishment was closed while `Ungraded`, with
  no letter grade at all.
- **`isCritical` is only shown for a definite true**, because null means the source published "Not
  Applicable" and flattening it would assert something nobody said.
- **The open establishment is in the URL**, so a single place is shareable, and an `id` that is not a
  positive integer is dropped rather than sent to the API to be told 404.

**Verified.** 156 web tests, `tsc -b`, build and lint clean. Checked end to end against the running
API — and that check found a real bug: gating the panel on the clicked candidates hid it entirely for
a `?id=` link naming an establishment outside the current view, which is most of them. `?id=21` is in
Staten Island and the opening view is Times Square. Now the record renders whether or not its pin is
on screen.

### Slice 6, as built

`list/ResultsList.tsx`, focus and Escape handling in the detail panel, and a camera instruction the
map will accept.

#### The list is the map, for anyone who cannot use the map

**Pins are pixels on a WebGL canvas.** They take no focus, they appear in no accessibility tree, and
until this slice a keyboard user could reach every filter and never reach a single restaurant.
Nothing about a `<canvas>` can be made to fix that, so the fix is not on the canvas.

It is also the panel the milestone's **first decision** committed to and that nothing had yet built:
the side list is the same data as the pins, held once and rendered twice, so a row is present exactly
when its dot is and either one opens the same record.

Two things it deliberately does not do. It **does not page** — the viewport response has no cursor,
it is the answer to "what is on screen", and paging through a viewport that stopped existing is not
a thing to offer. And it **does not render everything**: a viewport can hold a thousand
establishments and re-renders on every pan, so it shows fifty and says so. That is the smoothness
lesson applied to the DOM rather than to the map.

Every row carries its state **in words**, because the swatch beside it is decoration to a screen
reader and colour alone to everyone else, and the selected row is marked with `aria-current` rather
than only with a highlight.

#### The rest of the keyboard story

- **Focus moves into the detail panel when it opens**, onto the container rather than the close
  button, so a screen reader announces the establishment's name instead of the word "Close".
  Without it, activating a row leaves a keyboard user where they were while a panel they cannot see
  appears somewhere else.
- **Escape closes it.**
- **One visible focus style** across every control on the page. A keyboard user who cannot see where
  they are has no way to use any of this.

#### The camera instruction

The open item from slice 5, closed. A `?id=` link names an establishment that is usually nowhere near
the opening view, so the record used to open while the map showed a different part of the city. The
map now accepts a point to move to, and the caller sends one **only when the establishment is outside
the current viewport** — moving it for every selection would yank the camera out from under somebody
who clicked a pin they were already looking at.

**Verified.** 170 web tests, `tsc -b`, build and lint clean. The camera rule and the focus move were
both mutation-tested — each broken deliberately fails exactly the tests naming it. The list was
confirmed against the running API: "Showing 50 of 424", fifty rows, each with its state spelled out.

**Not verifiable here:** that the camera actually arrives. `easeTo` animates through a render loop
headless Chromium never runs, so the call can be asserted and the movement cannot. Confirmed from a
browser instead — along with a bug that only a browser could have found.

#### The camera snapped back, once

Reported: after being taken to an establishment, dragging away pulled the map straight back to it —
once, and then it behaved.

The cause was making the camera target a **derived** value. It read "is the chosen establishment off
screen?", which is true when the record arrives, false once the map gets there, and **true again the
moment the user drags away** — so it re-armed and fired. It happened exactly once because the second
drag left the answer unchanged, so nothing re-ran. That "once, then fine" shape is what identified
it.

A camera move belongs to the act of choosing something, not to where the map happens to be, so it is
now computed once per record that arrives and never recomputed; the viewport is read through a ref
so it cannot re-arm anything. The regression test walks the reported sequence — arrive, drag away,
drag away again — and was checked against the original code, which moves the camera twice.

#### Two smaller things from the same session

The page **flashed white** when following a link into the app. A full navigation paints before the
stylesheet is fetched, so the first frame was the browser default; the background is now declared
inline in `index.html`, which is the only inline style in the project and is there because it has to
be true before anything else loads.

And the tab said **"web"** — the Vite starter's title, on the page whose whole purpose is to be
opened by a stranger.

### Slice 7, part one: the client's address from behind the ingress

`src/Freshline.Api/Hosting/IngressConfiguration.cs`, wired in `Program.cs` before anything that reads
the address or the scheme. This clears the deploy-time blocker carried out of M4; **the deployment
itself is still to do**, along with `VITE_API_BASE_URL` and the production CORS origin, which cannot
be chosen until the front end has a URL.

The problem, restated: the rate limiter partitions on `RemoteIpAddress`, which behind any ingress is
the *proxy's* address. Every caller collapses into one bucket, so the first visitor to exhaust it
locks out everybody — the limiter becomes the outage it exists to prevent. The fix is to read
`X-Forwarded-For`, and that header is caller-supplied, so believing it unconditionally is worse than
ignoring it: anyone could then put a fresh value in it on every request and never be limited at all.

#### This does not use `KnownProxies`, which is what the open item above prescribed

Stated plainly because it reverses a decision written down earlier in this document, and because it is
the security-relevant part.

`KnownProxies`/`KnownNetworks` cannot be populated here. On the Container Apps consumption profile the
ingress addresses are managed by the platform, are not published, and change without notice. A list
of them would be a list of guesses that fails closed one day without warning — traffic rejected in
production for a reason nothing in the repository explains.

What bounds the trust instead is `ForwardLimit`. `X-Forwarded-For` is a list and each proxy
**appends** to it; ASP.NET Core reads that list right to left and `ForwardLimit` caps how many entries
it will walk. With a limit of one, only the rightmost entry is read — the one the ingress itself
appended. A caller who sends `X-Forwarded-For: 1.2.3.4` produces `1.2.3.4, their-real-address` by the
time it arrives, and the forged value is never reached.

The residual risk, not glossed: Microsoft's own documentation calls `ForwardLimit` "a precaution, but
not a guarantee". Clearing `KnownProxies` removes the check that the connection came from a trusted
address, so what is left is the assumption that **nothing can reach this container except through the
ingress**. On Container Apps with external ingress that holds — the container's port is not routable
from the internet. It is an assumption about network topology rather than about caller behaviour,
which is the better of the two to be left with, and it is verifiable against the deployed URL rather
than only arguable. That check is listed below and has **not** been run yet.

`ProxyHopCount` defaults to **zero**, and at zero the middleware is not registered at all rather than
registered with a limit of zero. Locally there is no proxy, so a machine that believed the header
would let any caller mint a bucket per request; not registering it means no configuration mistake can
switch that on by accident. A deployment that genuinely has a proxy says so explicitly — one, for
Container Apps, which puts a single Envoy ingress in front of the container and nothing else.

`XForwardedProto` is forwarded as well as `XForwardedFor`. The ingress terminates TLS, so without it
every request looks like plain HTTP to this process and `UseHttpsRedirection` would redirect a request
that already arrived over HTTPS — a loop, not an inconvenience.

#### How it is tested

There is no endpoint that reports the address the API decided you have, and adding one to make this
testable would mean adding a way to ask the API about its own internals. So the question is asked
through the component whose whole behaviour turns on the answer: **did these two requests share a
bucket?** Three tests, against a host configured with a two-request bucket that never refills:

- two callers behind the proxy get separate buckets — the failure this exists to prevent;
- a forged leading entry, different on every request, does not buy a fresh bucket — the security
  property;
- with no proxy declared, the header is ignored entirely — what makes the default safe.

144 backend tests pass, 0 warnings.

**Still to verify, on the deployed URL rather than here:** a request with a forged `X-Forwarded-For`
against the real ingress, confirming the limiter still counts it against the caller's real address.
The tests above prove the middleware's behaviour; only that check proves the hop count matches the
deployment.

### Slice 7, part two: making the repository deployable

The roadmap fixes the scope of this before it starts: *"Deployment at this milestone is done by hand
— Static Web Apps for the front end, App Service or a container for the API — and that is fine. M7
replaces it with Bicep and deploy-on-merge."* So there is no IaC here and no deploy workflow; both
would be M7 work done a milestone early. What is here is everything needed for the hand-deploy to be
short, repeatable, and written down: `Dockerfile`, `.dockerignore`, a build-time guard on the API
origin, and [`docs/deployment.md`](../deployment.md).

#### The defect this slice found: `VITE_API_BASE_URL`

```ts
const baseUrl: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5045'
```

That fallback is correct in development and is a trap in a build. Vite substitutes `import.meta.env`
at build time, so a production bundle built without the variable would ship to a real URL and ask
**the visitor's own machine** for its data. Every request fails, and it fails looking exactly like the
API being down — the site is broken in a way that points at the wrong component.

Two changes, at two different moments:

- **`vite.config.ts` fails the build** when `command === 'build'`, `mode === 'production'` and the
  variable is absent. This is the last moment the mistake is catchable, and failing here means there
  is no artifact to deploy rather than a broken one.
- **The fallback is guarded by `import.meta.env.DEV`.** In a production build the branch is the empty
  string, which makes the request path relative and sends it to the site's own origin. Still wrong —
  the API is a separate origin and will stay one — but wrong *visibly*, as a 404 from the site the
  user is on. A same-origin 404 describes itself; a request to the visitor's localhost does not.

Verified by building both ways rather than by reading the diff. Without the variable the build stops
with the error naming it. With it, the bundle contains the configured origin and contains
`localhost:5045` **zero times** — the development branch is compiled out, so that string cannot reach
a visitor at all.

CI passes `https://ci-build-is-not-deployed.invalid`. `.invalid` is reserved by RFC 2606 and is
guaranteed never to resolve, so a CI artifact mistaken for a deployable one fails against a name that
cannot exist rather than against something plausible.

#### The container

Root `Dockerfile`, multi-stage, non-root, port 8080. The build context is the repository root because
the API does not build alone — it references Core and Infrastructure, and `Directory.Build.props` at
the root is what promotes NuGet advisories to build errors. Building from the project directory would
have produced an image whose build had a weaker check than CI's.

`.dockerignore` excludes `appsettings.Development.json` specifically. It is gitignored, so it exists
only on a developer's machine — which is exactly where a real connection string lives — and `COPY
src/ src/` would otherwise bake it into a layer.

Verified by running it, not by it building:

| Check | Result |
|---|---|
| `whoami` / `id -u` in the container | `app`, uid **1654** — non-root |
| `GET /health` (liveness, runs no checks) | **200 Healthy**, with the database unreachable |
| `GET /health/ready` (readiness, checks the database) | **503**, with the database unreachable |
| `GET /openapi/v1.json` | **200** |

The second and third together are the point. The liveness/readiness split was designed in M4 on the
argument that a liveness probe which fails on a dependency causes a restart that cannot fix the
dependency — this is the first time that argument has been *observed* rather than asserted.

#### A warning that had been merged unread

The container build surfaced `ASPDEPR005`: `ForwardedHeadersOptions.KnownNetworks` is obsolete in
.NET 10, replaced by `KnownIPNetworks`. It was on a line written in part one of this slice, and part
one was reported as "0 warnings" — from an **incremental** build that did not recompile the file. A
clean `--no-incremental` Release build shows it; CI showed it too, in output nobody read, because
`TreatWarningsAsErrors` is `false`.

Fixed, and the three forwarded-headers tests still pass, which is what makes the swap
behaviour-preserving rather than merely compiling.

The design itself graduated to [ADR-0006](../adr/0006-trusting-the-ingress-not-the-caller.md), because
it outlives the milestone and because it supersedes an instruction ADR-0005 had already written down.
ADR-0005 is left untouched: ADR-0001 says decisions are immutable and a changed one gets a new record
with both kept, and "the record of having been wrong is part of the value" is the whole point of the
practice rather than a formality.

**Raised rather than quietly fixed:** a clean build of this solution now emits **zero** warnings, so
promoting warnings to errors in `Directory.Build.props` would cost nothing today and would stop the
next deprecation from merging unread. That is a repository-wide policy change affecting every future
build, which makes it the author's decision rather than an implementation detail — the same rule
`CLAUDE.md` applies to dependencies. Listed in the open items below.

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

- ~~**Establishments stacked on one coordinate have no way to be told apart**~~ — answered in slice
  5: a click resolving to more than one establishment opens the list, and the user chooses. See
  below.
- ~~**A shared `?id=` link does not move the map to the establishment it names**~~ — fixed in slice
  6. The map now takes a camera instruction, and the caller sends one only when the chosen
  establishment is outside the current view.

- ~~**The rate limiter partitions on `RemoteIpAddress`, which becomes the proxy's address behind any
  ingress.**~~ — answered in slice 7. Not the way this item prescribed: `KnownProxies` cannot be
  populated on Container Apps, so the trust is bounded by `ForwardLimit` and the middleware is not
  registered at all unless a proxy is declared. The reversal, the residual risk it leaves, and the
  one check that still has to run against the deployed URL are written up in "Slice 7, part one"
  above.
- **The API's CORS policy has no production origin configured**, and cannot have one until the front
  end has a deployed URL. The failure mode is a browser console error rather than anything
  server-side. The ordering this forces — API, then web, then *back* to the API to set
  `Cors__AllowedOrigins__0` — is written up in [`docs/deployment.md`](../deployment.md), because the
  last step is the one that looks optional and is not.
- **Warnings are not errors.** `TreatWarningsAsErrors` is `false` in `Directory.Build.props`, and one
  deprecation warning has already merged unread as a result (`ASPDEPR005`, slice 7). A clean build
  currently emits zero warnings, so turning it on would cost nothing today. Not done unilaterally:
  it changes every future build, which makes it a decision rather than a fix.
- **Nothing has been deployed yet.** The repository is deployable — image, build guard, documented
  steps — and no Azure resource exists. The forged-header check against a real ingress, which is the
  only way to confirm `ProxyHopCount` matches the real topology, is waiting on that.
- **`/health/ready` cannot be a continuously-polled probe against a serverless database.** It logs
  in, a login is an auto-resume trigger, and a database that never pauses spends Azure SQL's free
  grant in under two days. The endpoint keeps its value for a human or an occasional monitor; it
  loses it as a platform readiness probe. Written up in [`docs/deployment.md`](../deployment.md),
  and it is a genuine loss rather than a workaround — on an always-on database it is the right
  endpoint to poll.
- **The cost of a cold visit is unmeasured.** EF Core retry now absorbs the documented 40613 that a
  paused database returns to the first connection, but "absorbed" is not "instant", and how long a
  first visitor actually waits can only be measured against a deployed instance.
- **The rate limits are chosen, not load tested.** A real client panning a map is the first thing that
  will exercise them.
- ~~**The `outcome` filter is unmeasured**~~ — measured in slice 4 against the live database, warm
  cache, one workstation: **61–105 ms** against 26 ms unfiltered over a 0.2° × 0.15° box, so 2.5–4×
  the cost of no filter and not a problem at this scale. Same caveats as everything in
  `docs/performance.md`: warm, single machine, not a capacity claim.
- **No cold-cache performance measurement exists**, and every figure in `docs/performance.md` is
  warm-cache from a single unconstrained workstation.
- **Branch protection is not enabled server-side.** `.githooks/pre-push` is a local stand-in.
- **The 30-day ingestion lookback** remains an unmeasured assumption from M1.
