# M5b — Landing page and reporting suite

Roadmap entry: [M5b](../roadmap.md). Decisions that outlive the milestone graduate to an ADR; this
document holds the ones that do not, and the record of what was measured.

**Why "M5b" rather than M6.** M6 is already "Scoring and territories" in the roadmap, and ADR-0005
and several documents refer to M6 and M7 by number. This work was added after that numbering was
written down and referenced, so it is inserted rather than renumbered — a renumber would silently
change the meaning of every existing cross-reference.

## What this is

Two things the map alone cannot be.

**A front door.** Before this, the application *was* the map: a stranger arrived inside a tool with
no statement of what it was, whose data it showed, or how current any of it was.

**A reporting suite.** The map answers "what is near here". It cannot answer "which cuisines have
the worst results in Queens", because that is a question about aggregates rather than about a
viewport.

## Scope fence

Inherited from M5 and unchanged: **one source, one city, read-only.** Nothing here writes, nothing
here implies identity, and nothing here implies a second source. Saved reports would imply identity
and are therefore M6's problem, not this one's.

The new fence, specific to this milestone: **no generic query builder.** See the decision below.

---

## Decisions taken before implementation

### Named reports, not a report builder

The request was "a UI for running queries based on any number of parameters we see fit". That
describes a small BI tool, and it is rejected in favour of a fixed set of named reports, each
answering a specific question, each with its own filters.

The reasoning, in the order it matters:

- **A builder demonstrates nothing about this domain.** A query builder over restaurant inspections
  and one over insurance claims are the same artefact. The interesting thinking in this project is
  about *this data* — six grades collapsing to five outcomes, 3,605 establishments never visited,
  closure being separate from grade — and a builder hides all of it behind a generic control panel.
- **It is the hardest thing here to explain line by line.** Generic predicate composition is
  intricate, and `CLAUDE.md`'s bar is that the author can narrate every non-obvious line.
- **Arbitrary group-bys are arbitrary query plans.** Every other query in this system has a known
  shape and a measured cost; a builder gives up that property by construction.
- **The roadmap already argues against it**, in its own words: *"Breadth is the cheap kind of
  impressive; a system finished end to end is the expensive kind."*

**What a builder buys that this gives up:** questions nobody anticipated. Accepted, because a report
that was not anticipated can be added in an afternoon, and each one added is a question this project
can be shown to answer well.

### Every ranking states its sample size, and small samples do not top the table

**The highest-risk code in this milestone**, in the same sense that grading normalisation is the
highest-risk code in the system: it produces something that looks authoritative and can be quietly
wrong.

Rank cuisines by "percent Poor" and the top of the table will be cuisines with three establishments.
One bad inspection out of two is 50%, and it will outrank a cuisine with four hundred establishments
and a real problem. The table will look precise and mean nothing.

This is where `CLAUDE.md`'s "never invent a number" stops being a documentation rule and becomes a
product rule, because **a report does not display data, it asserts a conclusion.**

Settled in [ADR-0007](../adr/0007-reports-assert-conclusions.md): every group states its `n`,
rankings sort by the lower bound of a 95% Wilson score interval, and the percentage displayed stays
the observed one. Small samples sink under their own uncertainty rather than being excluded by a
threshold nobody can defend. Implemented as a pure function in Core — `ProportionEstimate` — because
it is a scoring rule, and tested against a published interval rather than against its own output.

### Reports are cacheable and the map is not

Ingestion runs daily, so a report's answer is stable for a day. The map's answer changes with every
pan. This is the difference that makes response caching worth having on one and not the other.

Implemented in `web/src/reports/reportCache.ts`, prompted by exactly the case it was written for:
leaving a filtered report for an establishment and pressing Back asked the API the same question
again, for an answer that could not have changed in the intervening seconds — and a report is the
most expensive thing this API answers, with the smallest rate-limit budget.

Keyed on the request and held for the lifetime of the page. The *promise* is cached rather than only
the value, so two components asking at once share one request — which also removes the duplicate
React's StrictMode produces in development. A rejected request is evicted, so one bad moment does not
break a report for the rest of the session.

**The staleness this leaves, stated rather than discovered:** a tab left open across an ingestion run
keeps showing the previous day's answer for any report it has already seen. Accepted, because a
time-based expiry reintroduces the refetch at an arbitrary interval for data that moves once a day.

### Report endpoints need their own rate-limit policy

ADR-0005 put every data endpoint in **one bucket**, sized against what a person panning a map
produces. A report is far more expensive per request than a pan and is requested far less often.
Sharing the bucket means a few reports can exhaust a map user's allowance and vice versa.

Done: `RateLimiting:Reports` is its own bucket — 15 burst, 10 per 60 seconds — with a partition key
prefixed so a caller's report allowance and map allowance cannot collide. Chosen, not measured, and
sized against the shape of the interaction rather than the cost of the query: somebody opens a report,
changes a filter two or three times, reads the table.

The 429 message is policy-aware, because a rejection quoting the map's numbers would send a caller
away to wait the wrong amount of time. Tested by exhausting the report budget and confirming the map
still answers.

---

## As built

### The shell, the landing page, and a summary endpoint

`web/src/routing/` — `route.ts`, `useRoute.ts`, `NavBar.tsx`. `web/src/landing/`. The map moved to
`web/src/map/MapPage.tsx` and `App.tsx` became the shell.

**Still no router**, and `route.ts` re-argues that rather than inheriting it, because the premise
changed: `urlState.ts` justified "no router" when there was one page. The reasons it survives are
that no path segment carries state — viewport, filters and selection are all query string already —
and that a router owns history, which would collide with the map's deliberate `replaceState` per pan.
What would reverse it is written down in the same comment: route parameters carrying state, nested
layouts, or per-route code splitting.

**Nav items are anchors with real `href`s.** A `<button onClick={navigate}>` looks identical and
silently loses middle-click, ctrl-click, "copy link address", the status-bar preview, and the
screen-reader announcement. Modified clicks are left entirely to the browser.

**`GET /establishments/summary`** is new, and exists so that no figure on the landing page is typed
into a component. A number written into the page is true the day it is written and false after the
next ingestion run.

Counts only — no rates, no averages, no "safest borough". Those are conclusions, and a conclusion
drawn over a whole city buries exactly the small-sample problem the reports have to handle
explicitly.

`latestInspectionOn` is **the source's freshness, not ours**: a successful ingestion run that finds
nothing new leaves it unchanged. A figure based on our own job history would report the data as
current at the exact moment the city went quiet.

**The figures are withheld entirely while loading**, rather than rendered as zeroes or dashes. A zero
here is a factual claim — "there are no establishments" — and a loading state must not assert one.

**The popstate test was verified by deleting the listener** and watching it fail, then restoring it.
jsdom cannot drive a real `history.back()` across the entries earlier tests push, so the test
dispatches the event directly; that limitation is stated in the test rather than left implied.

### Choosing a borough moves the camera

Reported from a browser: choosing a borough while looking somewhere else empties the map, because the
filter is applied to whatever viewport is on screen and that viewport contains none of it.

**The boxes are measured from the establishments**, returned on the existing `/filter-options`
response as a new `localityBounds` field — added alongside `localities` rather than reshaping it,
because the API's evolution rule is to add optional fields and never repurpose one.

Measured rather than taken from published borough outlines because they answer different questions:
this frames where the restaurants *are*, and an outline of Queens contains a great deal of Queens
with no restaurants in it.

| Locality | Latitude | Longitude |
|---|---|---|
| Bronx | 40.8003 – 40.9128 | −73.9312 – −73.7829 |
| Brooklyn | 40.5727 – 40.7377 | −74.0370 – −73.8581 |
| Manhattan | 40.6911 – 40.8729 | −74.0196 – −73.9148 |
| Queens | 40.5581 – 40.7960 | −73.9607 – −73.7017 |
| Staten Island | 40.4996 – 40.6457 | −74.2491 – −74.0632 |

**The outlier risk was checked, not assumed.** A minimum and a maximum are the two statistics least
robust to a single bad row, and ADR-0004 says a Southern Ocean geocode is possible — one would
stretch a box across the Atlantic. Measured: **zero** establishments outside New York, **zero** at a
zero coordinate, **zero** with coordinates and no locality. It is not defended beyond that check,
because the map already refuses to move its camera outside the city, so the worst a future bad row
can do is frame too much of New York rather than somewhere that is not New York.

**The camera move belongs to the act of choosing.** Written the obvious way — derived from "is the
current view inside the chosen borough?" — it would be true again the moment somebody panned within
that borough, and the map would drag itself back. That is the same bug slice 6 of M5 fixed in a
different shape, and it is why this is scoped to the change of locality instead. Clearing the filter
deliberately moves nothing: "show me everywhere" is not a request to go anywhere.

**A test found a real ordering bug.** The borough was recorded as handled *before* checking that the
bounds had loaded. Since the vocabulary is fetched asynchronously, a `?locality=Brooklyn` link ran
this effect first with the options still null, spent its one chance to frame on a render with nothing
to frame with, and then found itself already handled when the data arrived. Both cases are now
tested: a bare `?locality=` link frames the borough, and a link carrying a viewport *and* a borough
honours the viewport, because the sender already said where to look.

### The reporting page

`web/src/reports/` — `ReportsPage.tsx`, `sorting.ts`, `csv.ts`, `useOutcomeBreakdown.ts`.

**The table shows `n` beside every rate**, and the caption says in words that a small group can sit at
the top. That was a nicety in ADR-0007 until the measurement made it load-bearing.

**Sorting by the percentage column is allowed**, and gives the naive ranking. A column header that
does not sort by its own column would be an interface lying about itself; the defensible order is the
default, and the sample size is what makes the alternative readable.

**CSV rather than `.xlsx`.** "Export to Excel" almost always means CSV and Excel opens it; a real
`.xlsx` needs a library, and a dependency is a decision. Every export carries its filters, row count,
ungrouped count, sort order and source as comment lines — numbers that leave the page without their
context are precisely what this project's rules exist to prevent. Fields beginning with `=`, `+`, `-`
or `@` are neutralised, because an export hands source data to a program that executes some of it.

Two bugs found by writing the tests rather than after shipping: a backwards date range dropped both
dates and re-ran, so the table quietly reloaded as the *unfiltered* report underneath an error message
about the range; and the table omitted `noInspectionInPeriod`, so its columns did not reconcile
against its own total.

### A second report: the establishments themselves

Asked why a report showed no individual establishments, the honest answer was that only one report
existed and it happened to be the aggregate one. **A suite that can only aggregate cannot be drilled
into**, and a group-level CSV is far less useful than a row-level one.

`GET /reports/establishments`, on the same report budget.

**Not served by the existing list endpoint**, for two reasons. A cursor is a position in one
particular order — name — which is right for walking the dataset and wrong for a table somebody
wants sorted by worst result or most recent inspection. And adding a date range to that filter would
change what its `outcome` filter means.

**Bounded rather than paged.** Offset paging would allow server-side sorting, and M3 measured it
degrading with depth: 307 logical reads at page 461 against 9 for keyset. So up to 1,000 rows with
`isTruncated` — the trade the map already makes — and the client sorts every column. Truncation is
*observed* by taking one row more than the limit, because a page that is exactly full is otherwise
indistinguishable from the whole answer.

**Establishments with no inspection in the period are still listed**, with a null result. Dropping
them would quietly turn a list of establishments into a list of inspections. The row keeps its
`isAwaitingFirstInspection` flag, so "never inspected" stays distinguishable from "not inspected in
this period" — two different facts that a single blank cell would merge.

Verified against real data rather than only the fixture: **Queens + Poor returns 34 rows, and the
outcome breakdown independently reports 34.** The two compute "latest counted inspection" through
different code paths, so their agreement is the check worth having.

#### What the tests caught

The eleven new endpoint tests passed in isolation and **four failed in the full suite**. Every report
test shares one host and one limiter partition, and the additions took the collection past the report
budget of 15 — a failure mode a per-file run cannot reproduce. The fixture already raised the *main*
limiter's ceiling for exactly this reason; the second bucket added earlier in this milestone had not
been matched.

Raising it to 100,000 then failed **every** test in the collection, because `ReportRateLimitOptions`
caps these at 10,000 and `ValidateOnStart` refuses the host above it. The validation doing its job,
found by the tests it broke.

---

## Slices

| # | Slice | Status |
|---|---|---|
| 1 | App shell, routing, landing page, summary endpoint | **done** |
| 2 | Camera moves to a chosen borough | **done** |
| 3 | Report query layer in Core and Infrastructure | **done** |
| 4 | Report endpoints, with their own rate-limit policy | **done** |
| 5 | Reporting UI — selection, sortable table, CSV export | **done** |
| 7 | Second report — the establishments themselves | **done** |
| 8 | Clickable rows, report state in the URL, response caching | **done** |
| 9 | Map: clustering, prominent selection, off-screen indicator | **done** |
| 6 | Consolidation — ADR on report statistics, README, log | **done** |

**Needs line-by-line human review before merge:** any new dependency, and the small-sample handling
in any ranking report.

### Clickable rows, and a report that survives being left

**Websites were asked for and are not available.** Checked rather than assumed: across all 99,050
stored raw payloads, **zero** contain a website, a URL, or the string `http`. Adding one means a
second source — an API key, a bill, a connector — against a scope fence that says one source, and a
join on name plus address that is fuzzy: `DUNKIN` appears 307 times, and a wrong match does not fail
loudly, it points a reader at a different business.

So rows are clickable from data already held. The name links to that establishment **on the map**,
deep-linked at `?id=`, which is the first thing connecting the two halves of the product — the
machinery already existed. The phone is a `tel:` link; 23,485 of 23,528 have one, and it is the only
contactable detail the city publishes.

**The reports page keeps its state in the address bar** (`reports/reportUrlState.ts`). Clicking
through to an establishment and pressing Back used to land on a default view, because the report, the
filters and the sort lived in React state — which does not survive a navigation. The map settled this
in M5 and the reasoning is unchanged. A side effect is that a filtered report is now shareable.

**And a report's answer is cached for the session** (`reports/reportCache.ts`), which is the decision
booked above finally implemented. A test found a real bug in the date validation on the way:
JavaScript does not refuse an impossible date, it rolls it over — `new Date('2026-02-31')` is 3 March
with no `NaN` and no error, so a `Number.isNaN` check accepted it.

### The map: clustering, and what survives a cap

**Reported:** a dot holding eighteen establishments looked barely larger than one holding a single
establishment. True — nothing scaled with the count, so the only size difference on the map was
between states, 6.5 pixels for `Poor` against 4 for `Good`.

Clustering is MapLibre's own, and that is what makes consolidation vary with zoom: `clusterRadius` is
a **screen** distance, so what it covers on the ground changes with the camera for free, with no
zoom-dependent code and nothing recomputed per frame.

**28 pixels**, chosen from the dots rather than by taste: the largest pin is 6.5 and grows to 1.8× at
zoom 19, so two dots closer than about 24 pixels hide one another. Well short of MapLibre's default of
50, which is tuned for markers far larger than these. Nothing clusters above zoom 16. Size runs 7 to
26 pixels — a factor of four in radius, fifteen in area — which is steeper than the square root that
makes area proportional to count, deliberately: proportional area is right for a chart somebody reads
values from, and this is a map somebody scans.

#### The bug clustering exposed

Zooming out made red dots vanish. Measured over one area:

| viewport | items | truncated | `Poor` |
|---|---|---|---|
| tight | 564 | no | 2 |
| wider | 1,000 | **yes** | 8 |
| widest | 1,000 | **yes** | **3** |

**Zooming out showed fewer failed inspections than zooming in.** The map endpoint caps at 1,000 and
ordered by id, which correlates with nothing — so the rows it dropped were arbitrary, and `Poor` is 93
rows out of 23,528.

A cap is unavoidable; its *contents* are a choice. Ordered worst-first, the widest viewport returns
**87 of the city's 93** `Poor` establishments instead of 3, and drops `Good` ones — of which there are
12,861. Measured warm on this workstation: **80 ms** at the widest viewport against about 45 ms
before, and 31 ms at a tight one.

One bug on the way, found by measuring rather than by a test: `FirstOrDefault` over an `int` returns
**0** when an establishment has no inspections, and 0 was `Poor`'s rank — so every never-inspected
establishment sorted as a failure. The widest viewport came back with 920 of them and not one `Good`.

At city zoom the map can now show no `Good` establishments at all. That is the right thing to drop and
it makes the city look worse than it is, so the status line says so: *"the worst results first. Zoom
in to see everything, good and bad."*

### Finding what is selected

The selected establishment is drawn in a source of its own above every cluster and pin — a wide soft
halo for visibility, a hard white-ringed core for precision. A separate source because below zoom 16
the selection is frequently *inside a cluster* and has no feature to restyle.

When it is off screen, a button on the edge of the map points at its true bearing and returns you to
it. The angle needs no bearing arithmetic at all: `map.project` already accounts for bearing, pitch
and zoom, so the angle from the container's centre to the projected pixel is the angle on screen.
Written straight to the DOM rather than through React state, because it updates on every frame of a
gesture.

Tested on the **sign** of the angle rather than on the arrow appearing: screen `y` grows downwards, so
down-right is +45° and straight up is −90°. The tempting "correction" points the arrow at the
reflection of its target and passes any test that only checks visibility.

The record's own "Centre on map" button needed a request token. The focus effect keyed on the
coordinates, which is right for a `?id=` link and wrong for a button: press, pan away, press again is
the same coordinates, so the effect would not re-run and the button would appear broken exactly when
somebody wanted it.

---

## Open items

- ~~**The reporting statistics ADR is not written.**~~ — written as ADR-0007 before any report
  existed to use it, which was the point.
- **The interval assumes independent observations**, and inspections of the same establishment are
  not independent. Intervals are therefore slightly narrower than they should be. Stated in ADR-0007
  rather than corrected; the correction is a clustered variance estimate and lands the wrong side of
  the explicability rule for the size of the error.
- ~~**Report endpoints share the map's rate-limit bucket.**~~ — done, `RateLimiting:Reports`.
- **`/map` and `/reports` are paths, and a static host needs to serve `index.html` for both.** The
  dev server does this by default, which is exactly the kind of difference that shows up later rather
  than now.
- **No report has been measured.** Every query cost in `docs/performance.md` is from M3 and M4. The
  outcome breakdown runs a correlated subquery per establishment across the whole table; it returns
  quickly against a warm local database, and nobody has looked at the plan.
- **The cuisine vocabulary is the source's, uncurated.** 89 values, assigned by the city, never
  examined by this project. Every per-cuisine report inherits whatever inconsistency is in that
  field, which is a caveat that belongs beside any conclusion drawn from one.
- **`ProportionEstimate` assumes independent observations.** Inspections of the same establishment are
  not independent, so intervals are slightly narrower — slightly over-confident — than they should
  be. Stated in ADR-0007 rather than corrected.
