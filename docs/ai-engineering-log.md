# AI engineering log

How AI tooling was actually used to build this project, milestone by milestone. This exists because
"I use Claude" says nothing. What matters is where judgement was applied, what was rejected, how
output was verified — and, honestly recorded, where it was accepted without verification.

Entries are written at the end of each milestone and are not revised to look better afterwards.

---

## M0 — Scaffold

**Date:** 2026-07-25 · **Tool:** Claude Code (Opus 5)

### The decision the tooling got wrong first

The session started with a fully specified plan for a *different project* — an Azure document
processing pipeline with OCR and LLM extraction. That plan had been generated in an earlier session,
by the same tooling, and it was wrong in a specific and instructive way: it had been reverse-engineered
from a **single job description** and then presented as though it were aimed at the whole target
market.

I pushed back and asked whether it actually matched the jobs I want. It didn't. Pulling and tallying
seven real remote .NET/React postings showed:

| Requirement | Postings mentioning it |
|---|---|
| C# / .NET, React, REST, SQL, Git, CI/CD | 7 of 7 each |
| A cloud (Azure or AWS) | 6 of 7 |
| OCR / document extraction / IDP | **0 of 7** |
| Python | **0 of 7** |

The two headline features of the original plan appeared in none of the postings. The project was
scrapped and rebuilt around what the data actually said.

**The lesson, which generalises:** the tool will elaborate confidently and at length on a premise it
was given, and elaboration is not validation. A detailed plan reads as a researched plan. This one
had been sitting in a repository for weeks looking authoritative because it was *specific*, not
because it was *right*. Ask what the premise was and whether anyone ever checked it.

### What was delegated

Mechanical scaffolding: solution layout, project references, CI workflow, `.gitignore`,
`.editorconfig`, compose file. All of it verifiable by running it, which is why it was safe to
delegate.

### What was kept

The choice of project and domain. The tool offered a list; the list was declined and the actual
requirement — aggregate free public data into something a business would pay for, mapped and scored —
came from me. That framing is the reason this project exists in the shape it does.

### What was rejected during this milestone

- **A config-driven generic ingester.** Proposed first, then argued out of it: field mapping cannot
  express differing record grain or opposite grading directions, and the result is a bespoke
  configuration language with no type checking and no debugger. Reasoning recorded in ADR-0002.
- **Cosmos DB, Azure Functions, and a Python benchmarking component**, all carried over from the
  original plan. Each was there because it appeared on one job description, not because this system
  needs it. Dropped, and the reasons are written into the roadmap's out-of-scope section so the
  question does not get relitigated.
- **`npm create vite@latest -- --template react-ts`.** npm silently swallowed the `--template` flag
  and scaffolded a vanilla TypeScript app twice before this was noticed. It was noticed by *looking
  at the generated files*, not by reading the command's success output — the command reported success
  both times.

### What was caught, and how

- **A vulnerable transitive dependency.** The `webapi` template pulls `Microsoft.OpenApi` 2.0.0,
  which carries GHSA-v5pm-xwqc-g5wc. The restore warned; warnings are output nobody reads. Fixed by
  pinning 2.7.5 (confirmed as the first patched 2.x release by reading the advisory, not by guessing)
  and by promoting NU1901–NU1904 to build errors in `Directory.Build.props` so the next one stops the
  build instead of scrolling past.
- **A config that compiled but did not type-check.** `defineConfig` imported from `vite` accepts a
  `test` block at runtime but fails `tsc -b`. Caught because the build script runs the type-checker
  before bundling. This is the argument for `tsc -b && vite build` over `vite build` alone.

### Where I took the tool's word for it

Recorded plainly, because these are the parts a reader should treat as unverified:

- **The per-city grading claims in ADR-0002** — that New York uses letter grades from a
  lower-is-better numeric score while Chicago publishes pass/fail with no score, and that record
  grain differs between them. This is load-bearing for the entire connector design and **I have not
  yet looked at either dataset myself.** It gets verified at M1 against real API responses, and if it
  is wrong, ADR-0002 gets superseded rather than quietly edited.
- **Data availability beyond NYC.** The NYC dataset was checked directly. Chicago, LA, and "200+
  Socrata portals" came from search results and are assumed, not confirmed.
- **That MapLibre plus open tiles costs nothing at this scale.** Plausible, unverified. It becomes a
  real number in `docs/cost.md` or it does not get claimed.
- **That .NET 8 reaches end of support in November 2026**, which is why this targets .NET 10.

### What I'd tell a junior

The failure mode is not that the tool writes broken code — broken code announces itself. It is that
the tool will build something coherent, detailed, and internally consistent on top of a premise
nobody checked, and detail is very easy to mistake for diligence. The most valuable thing done in
this entire session was asking "where did this requirement come from," and the answer was one job
posting.

---

## M1 — Ingest one city

**Date:** 2026-07-25 · **Tool:** Claude Code (Opus 5)

### Settling M0's debt

M0 closed with an explicit IOU: ADR-0002's factual claims about the data had been asserted from the
assistant's memory, and nobody had called either dataset. M1 opened by calling them. The results,
all from live unauthenticated requests against 295,294 rows:

| ADR-0002 claim | Verdict |
|---|---|
| NYC scores are lower-is-better | **Confirmed.** Mean score by grade: A 10.21, B 22.38, C 41.71 across 129,394 graded rows. |
| NYC issues grades A/B/C | **Wrong.** Six values: A, B, C, N, Z, P. |
| The grade is *derived from* the score | **Too strong.** Ranges overlap — grade A reaches 43, grade C starts at 0. |
| Record grain differs between sources | **Confirmed for NYC** (one row per violation). Chicago still unverified. |
| Identifiers are per-city and not globally unique | **Unverified.** Not testable from one source. |
| Some datasets are restated in place | **Confirmed, and worse than described.** |

ADR-0002 was superseded by ADR-0003 rather than edited, so the original stays legible as a record of
what was believed and on what basis.

The headline correction is one nobody predicted. `record_date` — the only field in the NYC dataset
that looks like a change timestamp — holds **three distinct values across all 295,294 rows**, all
stamped within six seconds of each other. It timestamps the portal's whole-dataset extract, not the
row. A watermark built on it would re-fetch everything, every run, and still never reveal what had
changed. That single query changed the ingestion design from "watermark" to "watermark plus lookback
window", which is the mechanism this milestone actually turns on.

### The near-miss worth remembering

The natural key is `(camis, inspection_date, inspection_type, violation_code)`. Across the Staten
Island slice this milestone ingests, it has **zero collisions**. Across the full city it has **140
colliding groups, 280 rows**.

Had the key only been checked against the data being ingested — which was the obvious thing to do,
and what I nearly did — the unique index would have passed every test in M1 and failed the first
time the borough filter was widened. The collisions turned out to be exact duplicates that NYC
publishes twice, verified by re-grouping with `score`, `grade`, `action` and `critical_flag` added
and getting the same 140 groups, so deduplication is lossless rather than silent data loss.

**Generalises to:** validate a uniqueness assumption against the whole population, not the sample
you happen to be loading.

### Three ways the tooling produced a confident wrong answer

All three were caught, and all three would have been believable if they hadn't been.

- **HTTP 200 that means nothing.** Probing the Tennessee inspections portal for an API, the guessed
  paths `/api/inspections` and `/api/v1/inspections` both returned **200** — and 303KB of Webflow
  HTML. The site is client-side routed, so every unknown path returns the same page. The tell was
  `Content-Type: text/html`. A status code is not evidence a resource exists.
- **A keyword search against an unread vocabulary.** Counting pest-related violations, a query for
  violation descriptions containing `VERMIN` returned **0**. NYC never uses the word — it writes
  "rodents, insects or other pests" and "evidence of mice". A zero from a search you designed is not
  a finding about the data; it is a finding about your search. This is now the reason the schema
  indexes and filters on `violation_code` and treats `violation_description` as prose.
- **A sampled row read as a schema.** `$limit=1` came back without `score`, `grade` or
  `violation_code`, which reads as "this dataset has no grade field". Socrata omits keys that are
  null for that row. The real schema, from the view metadata endpoint, has all of them.

### Where I got the recommendation wrong

I offered Boulder County, Colorado as the "small dataset, fast iteration" option — 1,313 rows,
genuinely the smallest real candidate. Then the question "what does this give a business?" forced the
selection criteria to be written down, and Boulder fails them: it publishes one row per inspection
with no violation detail, so it cannot answer "who in my territory needs pest control", which is the
product. I had optimised the recommendation for iteration speed without checking it against what the
thing is for. Retracted before anything was built on it, but it was the user's question that caught
it, not my own check.

Related, and the same root cause: scoping took four rounds. The product question — *what is this data
worth to a buyer* — should have come **before** the menu of datasets, not after it. Once it was
asked, the choice was nearly forced: NYC is the only verified source carrying violation codes,
coordinates, a cuisine field for the planned filter panel, and a new-openings signal.

### What the pushback found

Asking for Nashville, Franklin and then Hawaii looked like scope churn and was not. Checking them
properly produced a real constraint that now sits in the README: Tennessee and Hawaii both publish
inspections **through the same third-party vendor**, whose `robots.txt` ends `User-agent: * /
Disallow: /` and names AI crawlers and "content aggregators" explicitly. Nashville's own portal has
migrated off Socrata to ArcGIS Hub and holds no inspection data; Franklin's Socrata portal holds only
aggregate building-permit statistics. Neither state has bulk-accessible restaurant inspection data.

A records request to the Tennessee Department of Health was drafted rather than working around the
robots policy — the legitimate route is slower and is the only one that survives being described
out loud in an interview.

### What was delegated, and how it was verified

- **The connector, schema, upsert and worker.** Verified by running it: `docker compose up`, migrate,
  ingest twice. Run 1 fetched 3,237 rows and inserted 899 establishments, 1,026 inspections, 3,102
  violations. Run 2 re-read 367 rows through the 30-day lookback overlap and inserted **0**, with
  every row count identical. That is the milestone's acceptance criterion, and it was then written
  as a test rather than left as a thing I watched happen.
- **The tests were mutation-checked.** A green test proves nothing until it has been seen to go red.
  Inverting `MapSeverity` made the grading-direction test fail with a message naming the inversion;
  breaking deduplication made four integration tests fail. Both were reverted and the suite is green
  — 38 tests.
- **Column widths were measured, not guessed** — `max(length(field))` across the whole dataset, then
  roughly doubled for headroom, with the measurements recorded in the source.

### Where a human still has to look

Per CLAUDE.md these are the things AI output does not get to land unreviewed, and they have **not**
had that review yet:

- **The EF Core migration** (`20260726040641_InitialCanonicalSchema`). It was read and applied
  successfully to real SQL Server, and the delete behaviours were chosen deliberately — `Restrict`
  on the provenance foreign keys, because cascading from `SourceRecords` gives SQL Server multiple
  cascade paths to `Violations` and it rejects that outright. Still wants line-by-line eyes.
- **Five new package references**, each justified in `Freshline.Infrastructure.csproj`:
  EF Core SqlServer and Design, `Extensions.Http`, and two Options packages. A dependency is a
  decision, and this is the decision being surfaced rather than assumed.

### Where I took the tool's word for it

- **The 30-day lookback window.** Chosen to be comfortably generous, and entirely unmeasured —
  nothing has established how far back NYC actually restates records. It is flagged as an assumption
  in the options class, in ADR-0003 and in the roadmap, and it is not quoted anywhere as a finding.
- **Chicago and LA.** Confirmed free and unauthenticated by calling them and reading row counts.
  Their *schemas and grading directions* are still unverified — column names are consistent with
  ADR-0002's description, but no value has been read. M2's job.
- **That a commercial vendor already sells this data.** The assistant said it believed one exists and
  declined to name it as fact. Unverified, and worth checking before the README makes any claim about
  market position.
- **The clean-clone setup instructions.** The commands in the README were run on my machine, not
  against a fresh clone. Marked as such rather than claimed to work.
- **Socrata's anonymous rate limit.** The old README asserted "no token under 1,000 req/hr". Nobody
  measured that. The number has been removed rather than restated.

### What I'd tell a junior

M0's lesson was that a confident plan can rest on an unchecked premise. M1's is narrower and more
practical: **the questions that changed this design were all questions about values, not about
schemas.** Column names told me NYC has a `grade` field and a `record_date` field. Only querying the
values told me that `grade` has six possible entries and is null on more than half the rows, and that
`record_date` is not a row timestamp at all. Reading the documentation would have produced a
plausible, working, wrong ingester.

The other half: when scoping felt like it was dragging, the thing that unblocked it was not another
list of options. It was being asked what the data is actually worth to somebody. Every technical
choice after that point had an obvious answer.

---

## M3 — Spatial and query performance

**Date:** 2026-07-26 · **Tool:** Claude Code (Opus 5)

### The milestone disproved its own premise

M3 existed to add a spatial index and measure the improvement. The measurement said the spatial index
made the map query **2.4× more expensive** — 40,359 logical reads against 16,933 for a plain
`BETWEEN` on latitude and longitude.

The reason is unglamorous. `Establishments` is about 1,408 pages, roughly 11 MB. Scanning it once
beats seeking a spatial index and then doing 7,290 key lookups back into the clustered index. A
spatial index hits the same selectivity tipping point as any other index, and at 23,528 rows the
table is simply too small for it to win.

The actual 3.9× improvement came from two ordinary things: an `INCLUDE` on the inspections index to
remove key lookups, and replacing two correlated subqueries with one `CROSS APPLY`. Neither is
spatial. Neither was what the milestone was about.

This is the most useful thing in the project so far, and it only exists because the milestone was
written as "measure it" rather than "add a spatial index". A version of this project that assumed the
index helped would have shipped the assumption, and it would have looked exactly the same.

### The mistake inside the measurement

The first reading was 66,536 reads before and 16,933 after, and I nearly attributed all of it to the
query rewrite. Re-running the *original* query after the covering index existed gave 32,458 — the
naive query had improved on its own.

So the honest attribution is roughly half the index and half the rewrite, not all rewrite. Both
numbers were real; the story built from them would have been wrong. **Change one thing, measure,
change the next.** Making two changes and measuring once at the end produces a number you cannot
apportion, and the temptation is to credit whichever change you found more interesting.

### The bug that widening found

Scope was widened from Staten Island to all five boroughs so the measurement had enough rows to mean
anything. That surfaced a genuine defect that had been latent since M1: **the watermark recorded how
far ingestion had reached, but not what it had been asking for.**

The stored position of 2026-07-22 was earned while requesting one borough. Reusing it against a
request for the whole city would have left four boroughs with no history before that date — silently,
while the row count grew by twenty thousand and every log line read as success.

`SourceWatermark` now stores the scope it was earned under, and a mismatch discards it. Two tests
cover it in both directions, because a signature that changed on every run would satisfy the first
test while turning every run into a full backfill.

Worth naming the general shape: a stored position is only meaningful together with the question it
answered. That applies well beyond watermarks.

### Where a rule was deliberately bent

`CLAUDE.md` says Core takes no package references. Spatial support means `NetTopologySuite` in Core.

I raised it rather than working around it quietly, argued that the rule targets infrastructure
(persistence, transport, cloud SDKs) rather than a dependency-free geometry library, and recorded the
trade-off in ADR-0004 as the conventions require. The alternative — an EF shadow property — would
have preserved the rule exactly and made every spatial query stringly typed.

That is a judgement, not a fact, and it is the kind of thing that should be argued with rather than
inherited. It is written down so it can be.

### Verification

- **Both key correctness risks are pinned by tests.** Coordinate order is the spatial equivalent of
  the grading direction: NetTopologySuite takes (X, Y) — longitude then latitude — while T-SQL's
  `geography::Point` takes (latitude, longitude). The two APIs that write this same column take their
  arguments in opposite orders. A swap throws nothing and relocates every New York restaurant to the
  Southern Ocean. There is a unit test on the constructor and an integration test that compares the
  stored geography against the published coordinates for **every row in the database**.
- **The measurements reproduce.** Logical reads are identical across runs; the radius-query CPU
  result was run twice and held (101 ms and 136 ms with the index forced off, 0 ms with it allowed).
- **Elapsed time was deliberately not used to conclude anything.** At this data size several readings
  came back as `0 ms`. Logical reads and CPU are the stable metrics; reporting elapsed milliseconds
  as a result would have been decoration.
- 47 tests green.

### Where a human still has to look

- **Two migrations.** `AddSpatialLocation` — which includes hand-written SQL for the backfill and for
  `CREATE SPATIAL INDEX`, since EF's migration API cannot express the latter — and
  `CoverLatestInspectionLookup`. Both applied cleanly, and `AddSpatialLocation`'s `Down` drops the
  index before the column it is built on, which is the part that would fail if it were wrong.
- **Two new package references**: `NetTopologySuite` in Core and
  `Microsoft.EntityFrameworkCore.SqlServer.NetTopologySuite` in Infrastructure.

### Where I took the tool's word for it

- **That the spatial index is worth keeping.** It does not help the query it was added for. Keeping it
  rests on M6's saved territories needing radius search — a feature that does not exist yet. That is
  speculative and is labelled as such in ADR-0004 and in `performance.md`.
- **Warm-cache numbers only.** No cold-cache measurement was taken, so every figure describes a
  server whose working set is already in memory.
- **That the conclusions survive more data.** 23,528 establishments is small, and the spatial finding
  in particular depends on the table being cheap to scan. Nothing has been measured at 10×.
- **The 30-day lookback**, still an unmeasured assumption carried from M1.

### What I'd tell a junior

M1's lesson was that the questions worth asking are about values, not schemas. M3's is narrower:
**write the milestone as "measure it", not as "add the thing".**

"Add a spatial index" would have been completed successfully, in less time, with a worse outcome and
nobody any the wiser — including me. The only reason there is a finding here at all is that the
acceptance criterion was a before-and-after with plans rather than the existence of an index.

And the corollary, learned the slightly harder way: measure between changes, not just at the ends.
