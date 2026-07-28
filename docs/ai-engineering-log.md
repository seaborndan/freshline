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

---

## M4 — API

**Date:** 2026-07-26 · **Tool:** Claude Code (Opus 5)

### The milestone's most valuable output was a bug in the previous milestone's conclusion

M3 finished with a measured, plan-backed, written-up recommendation: get the latest inspection with
`CROSS APPLY`. M4 implemented it and found it was wrong. `CROSS APPLY` is an inner join, so every
establishment that had never been inspected vanished from the result — **19,923 of 23,528 rows
returned**, with the 3,605 missing being exactly those awaiting a first inspection. Which is the
greenfield signal the product is partly built on.

Nothing failed. The query ran, returned thousands of rows, and looked healthy. **No performance
measurement could ever have surfaced it, because the fastest way to answer a question is to answer
less of it.** The correctness fix turned out to be free: identical logical reads, 1,307 more rows.

The M3 block in `docs/performance.md` was left as written with a warning attached rather than edited,
on the grounds that a quietly corrected number is indistinguishable from one that was never wrong.

### Where measuring twice reversed a conclusion I had already drawn

Against the M3 indexes, EF Core's generated SQL for the list query cost 1.6× a hand-written
`OUTER APPLY`, and I had concluded — with numbers in hand — that this query should drop to raw SQL.
An hour later that was wrong. The window function was expensive because it scanned the *clustered*
index; once a narrow covering index could answer it, the same plan fell from 2,809 logical reads to
132, and the gap to hand-written SQL closed to 7%. **The fix was the index, not the ORM.**

The generalisable part: a comparison between two implementations is only valid against the schema it
was run on. I had measured the right thing and drawn a conclusion about the wrong variable.

And the map endpoint lands on the *opposite* side of the same argument — at 1,000 rows the window
form beats `OUTER APPLY` by 18×, because `APPLY` costs roughly two reads per row while the window
costs one index pass regardless. Two endpoints that look like the same query with a different
`WHERE` clause, and the crossover between them sits near 55 rows.

### Three things found by running the thing rather than by testing it

Every one of these passed a green test suite first.

- **The rate limiter's rejection message said the API allows "roughly 0 requests per second".** It
  divided the two replenishment settings into a per-second rate, which rounds to zero at slow refill
  rates. True to two decimal places and useless. It now states the configured numbers verbatim.
- **The OpenAPI document described no authentication at all.** `AddOpenApi` does not infer a security
  scheme from registered authentication, so `/me` appeared callable by anyone, returned 401 to
  everyone, and offered nowhere in the UI to enter a token — in a milestone whose acceptance criterion
  is that a *stranger can explore live documentation*. The first fix then produced `"security": [{}]`,
  a valid and entirely empty requirement, because the scheme reference cannot serialise its own name
  without a host document. Both were found by reading the generated JSON.
- **The Development CORS origin was written to a gitignored file.** It would have worked on exactly
  one machine, and everyone else — including CI and M5's web app — would have hit a CORS error in a
  browser console with nothing pointing at configuration.

### The security comment that was confidently wrong

I wrote, on the `ValidAlgorithms` pin, that it defeats the algorithm-confusion attack — signing an
HS256 token with the API's published RSA public key as the HMAC secret. I had a test minting exactly
that token, and it passed.

Then I deleted the pin and ran it again. **It still passed.** What refuses that token is the key set:
an `RsaSecurityKey` cannot serve as an HMAC key, so nothing resolves for HS256. The pin is real but
narrower — it refuses RS512 signed by the correct private key, which is now its own test and does
fail without the line.

Both are kept. What is worth recording is the failure mode: a passing test plus a plausible
explanation is not evidence that the explanation is right, and in a security file the wrong
explanation is precisely what someone reads before deciding a line is redundant. The check that
caught it took two minutes — delete the line, run the test, see whether it fails.

### Where a rule was applied rather than bent

The asymmetric key came out of taking the milestone's own words literally. The brief said this API
validates tokens and does not issue them; a shared symmetric secret contradicts that, because with
HMAC the power to verify *is* the power to forge. RSA makes the split a property of the cryptography
rather than a promise about restraint — and as a side effect the auth configuration contains nothing
confidential at all, so `CLAUDE.md`'s no-secrets rule is satisfied by there being no secret.

### What was delegated, and how it was verified

- **Rate limiting and CORS**, verified against the running API over real sockets rather than only
  through the in-memory test host — which sets no `RemoteIpAddress` and therefore cannot test per-IP
  partitioning at all. 127.0.0.1 was driven to 429 while 192.168.1.192 got a fresh bucket from the
  same instance.
- **JWT validation**, verified end to end with a keypair from `openssl` and a token hand-assembled
  from base64url segments and signed with `openssl dgst`. Nothing in this repository produced that
  token, which is the strongest available form of the claim that this API validates rather than
  issues.
- **136 tests green, 0 warnings**, and one dependency added.

### Where a human still has to look

- **All of slice 6.** Auth logic, flagged before it was written and flagged again in the PR. The
  specific list is in `docs/milestones/m4-api.md`: every line of `TokenValidationParameters`, the
  agreement between `MapInboundClaims`, `NameClaimType` and `RoleClaimType`, and the deliberate
  asymmetry where an *unconfigured* key starts the API but a *malformed* one fails startup.
- **The slice 2 index migration**, `CoverEstablishmentListQuery`.
- **One dependency added**: `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.10, pulling seven
  transitive `Microsoft.IdentityModel.*` packages at 8.19.2.

### Where I took the tool's word for it

- **The rate limits themselves.** 60 burst, 30 per 10 seconds. Nothing has load tested this API;
  those numbers are sized against what a human browsing a map produces, which is a much weaker
  justification than a measurement, and they are labelled as such wherever they appear.
- **That per-IP partitioning is the right granularity.** It is per-instance and per-address, so it
  slows one caller down and does nothing about many. Adequate here, and not a defence against a
  distributed attack.
- **That the `outcome` filter is affordable.** It is correct — there is a test proving it matches the
  latest inspection rather than any past one — but nobody has looked at what it costs, and it is the
  filter most likely to be slow.

### What I'd tell a junior

M3's lesson was to write the milestone as "measure it" rather than "add the thing". M4's is the
sharper version of the same idea: **a test suite tells you the code does what you told it to do, and
nothing else.**

Everything genuinely wrong this milestone — the dropped 3,605 rows, the "0 requests per second"
message, the invisible auth in the documentation, the security comment naming the wrong cause — got
past a green suite. Three were found by running the thing and reading the output, and one by deleting
a line to see whether anything noticed.

So: **when you believe a specific line is what prevents a specific failure, delete it and check.** If
nothing fails, you have learned something more valuable than a passing test — you have learned that
your explanation was wrong, while it is still cheap to find out.

## M5 — Map UI

**Date:** 2026-07-27 · **Tool:** Claude Code (Opus 5)

### The suite was green and the map was blank

Seventy-seven tests passed. The user opened the page and reported: *"i dont see any pins or
colors/highlighted establishments anywhere on the map."*

The cause was a stale closure — a `style.load` handler registered once, holding the first render's
empty `establishments` array forever. What is worth recording is not the bug but **why the tests could
not see it**: the MapLibre test double fired `style.load` *synchronously*, during construction, which
is the one ordering a real browser can never produce. A browser loads a style over the network, so the
handler is always registered before the event arrives. The double had made the bug impossible by
construction, and then confirmed the code was correct.

The tests were not weak. They were **wrong about the world**, and being green was a consequence of
that rather than evidence against it. `MapView.test.tsx` now fires nothing on its own, and each test
drives events in the order a browser would.

This is M4's lesson in a harder form. There, a green suite failed to prove an explanation was right.
Here, a green suite actively asserted something false, and the only instrument that detected it was a
person looking at a screen.

### A number I reported that meant nothing

While verifying the pins I reported "223 pins painted", from `queryRenderedFeatures`.

That function reads what the renderer has drawn. Headless jsdom never runs a render loop, so it
returns 0 whether the map is perfect or broken — and 223 was not a measurement of anything. It was
deleted from the milestone document rather than softened, because a plausible number with no method
behind it is worse than an empty section: the empty section invites the question.

`CLAUDE.md` says never invent a number. The subtler version learned here is that **a number produced
by a real function in a real test run can still be invented**, if the environment is incapable of
producing the thing being measured.

### "0 warnings", from a build that had not looked

I reported the forwarded-headers PR as building with zero warnings. It did not. `ASPDEPR005` —
`KnownNetworks`, obsolete in .NET 10 — was sitting on a line I had written in that same PR.

The build I ran was **incremental**. The file had not changed since the previous compile, so nothing
recompiled and nothing re-reported. CI printed the warning too, into output nobody reads, because
`TreatWarningsAsErrors` is `false` here.

It surfaced only because a container image build compiles from scratch by construction. Fixed, with
the three forwarded-headers tests still passing — which is what makes the swap behaviour-preserving
rather than merely compiling.

The generalisable part is small and sharp: **"the build is clean" is a claim about the build that ran,
not about the code.** An incremental build that skipped the file in question cannot support it.

### Three rounds of chasing the wrong cause

The user reported panning and zooming as "not buttery" — and then reported it twice more, after fixes
that did not fix it.

Two hypotheses died by measurement rather than by argument: pin count was identical either side of the
rough zone, and layer count was *higher* in the smooth one, which is the opposite of what the theory
predicted. Only once both were dead did measuring the tiles themselves show CARTO's vector tiles
stopping at z14 — **389 KB at z14, HTTP 400 above it.** The map had been overzooming a tile set that
does not exist. The fix was a hybrid: raster geometry, vector labels above z14 only.

What I would do differently: I proposed fixes for the first two hypotheses *before* measuring either.
Both measurements took minutes and both falsified the theory immediately. **Two of those three rounds
were avoidable, and they were spent on the user's time rather than mine.**

### The caption that made a correct map look broken

The status line said "518 places". The user replied: *"certainly doesnt look like 518 dots."*

They were right to count. 518 establishments occupy 306 distinct points — one address in the city
carries 49 — so the map was correct and the sentence describing it was not. A reader who counts dots
and finds a third of the claimed number concludes the map is broken, which is the exact opposite of
what a status line is for. It now gives both numbers and says why they differ.

Not a bug in any code: a true statement that produced a false belief. No test covers that category.

### An investigation that correctly found nothing

Violation descriptions looked like mojibake in terminal output — `â€™` where an apostrophe belonged.
Before touching any encoding handling I queried the database directly: **9,963 rows containing U+2019,
zero containing the mojibake byte sequence.** The data was clean. My terminal was decoding UTF-8 as
cp1252.

Recorded because a non-finding is a result. The tempting move was a defensive "fix" in the ingestion
path, which would have corrupted correct data to satisfy a display artefact in a tool that is not part
of the product.

### Two deployment traps, both silent, both caught before shipping

- **The web build's API base URL.** `client.ts` fell back to `http://localhost:5045`, and Vite
  substitutes `import.meta.env` at *build* time — so a production bundle built without
  `VITE_API_BASE_URL` would ship to a real URL and ask **the visitor's own machine** for data, failing
  on every request while looking exactly like the API being down. The build now refuses to run without
  the variable, and the fallback is `DEV`-guarded. The compiled bundle contains `localhost:5045`
  **zero times** — which is the verification that matters. Not "unused". Absent.
- **The readiness probe against a serverless database.** `/health/ready` queries the database, a login
  is an auto-resume trigger, and Azure SQL's free grant is worth roughly 40 hours of being *awake* per
  month. A platform probe polling it means the database never pauses and the grant is gone in under
  two days. Liveness and readiness both point at `/health` on this platform — a real loss of signal,
  recorded as one rather than dressed up as a trick.

Neither was findable by any test in this repository. Both came from reading the platform's own
documentation before provisioning anything, which is the deployment equivalent of running the thing.

### Where a plan turned out to be unfollowable

ADR-0005 prescribed `KnownProxies` populated with the ingress's real addresses, "and only that way
round". On Container Apps those addresses are platform-managed, unpublished, and change without
notice — a configuration value that must match something unknowable is a scheduled outage.

ADR-0006 records what was done instead: trust bounded by `ForwardLimit`, which reads only the entries
the proxies themselves appended. ADR-0005 was left untouched, per ADR-0001's rule that decisions are
immutable and a changed one gets a new record with both kept.

The earlier ADR was not careless. It was written before a deployment target existed and was correct in
general. **It became wrong by acquiring a context**, which is the ordinary way architectural decisions
expire.

### What was delegated, and how it was verified

- **The colour scale**, chosen on measured colour-vision separation rather than on convention. The
  intuitive green-for-good / red-for-bad pair is ΔE 4.1 under deuteranopia — the two states a user
  most needs to distinguish, rendered nearly identical for the most common form of colour blindness.
- **The container image**, verified by running it rather than by it building: non-root uid 1654,
  liveness 200 and readiness 503 against an unreachable database. That pair is the first *observation*
  of the liveness/readiness split M4 designed on argument alone.
- **The initial viewport**, measured against the API rather than guessed, then reshaped to the window
  aspect ratio after `fitBounds` was found to fit the requested box *inside* the window — producing a
  wider fetch than intended, and 19 pins over the truncation limit.
- **144 backend tests, 171 web tests, 0 warnings.** No new dependencies: `maplibre-gl` was already
  present from M0, and OpenAPI codegen was turned down in favour of a hand-written contract with
  runtime boundary validation.

### Where a human still has to look

- **`IngressConfiguration.cs`** — auth-adjacent *and* deployment configuration, on `CLAUDE.md`'s
  line-by-line list twice. Reviewed by summary rather than line by line, at the author's instruction.
  The reasoning in it is longer than the code.
- **The whole deployment**, when it happens. Nothing is deployed and the runbook in
  `docs/deployment.md` has not been executed.

### Where I took the tool's word for it

- **That `ProxyHopCount: 1` is correct for Container Apps.** The tests prove the middleware behaves
  correctly at a given hop count. Only a forged header against a real ingress proves the count matches
  the topology, and nothing is deployed.
- **Every cost and cold-start figure.** All read from Microsoft's documentation, none measured. What a
  first visit actually costs a person is unknown.
- **That the hybrid basemap is smooth.** The user said it was — *"this is a whole lot better"* — which
  is the correct instrument for that question and is not a measurement. No frame timings were captured.

### What I'd tell a junior

M4's lesson was that a test suite tells you the code does what you told it to, and nothing else. M5
sharpens it: **a test double is a theory about the world, and it can be wrong in exactly the direction
that makes your bug invisible.**

The blank map, the meaningless pin count and the false "0 warnings" share one shape. In each case an
instrument reported success while being structurally incapable of observing the failure — an event
fired in an order browsers cannot produce, a render query in an environment with no renderer, a
compile that skipped the file. None of them lied. Each answered a narrower question than the one I
believed I was asking.

So the habit worth building is not "write more tests". It is: **before trusting an instrument, ask
what it would do if the thing were broken.** If the answer is "the same thing", nothing has been
measured yet — and on this milestone, every single time, the person looking at the screen found it
first.

## M5b — Landing page and reporting suite

**Date:** 2026-07-27 · **Tool:** Claude Code (Opus 5)

### The most useful thing I did was talk someone out of what they asked for

The request was a reporting suite with "a UI for running queries based on any number of parameters we
see fit". That is a small BI tool, and building it would have been the wrong answer to a reasonable
question.

The argument that carried it was not mine — it was already in this repository, in the roadmap:
*"Breadth is the cheap kind of impressive; a system finished end to end is the expensive kind."* A
query builder over restaurant inspections and one over insurance claims are the same artefact. The
interesting thinking in this project is about *this* data — six grades collapsing to five outcomes,
3,605 establishments never visited, closure being a fact separate from the grade — and a generic
control panel hides all of it.

Named reports instead: each one a question somebody chose to ask, with a shape that can be indexed,
measured and explained.

What it gives up is real and worth stating: questions nobody anticipated. Accepted, because an
unanticipated report can be added in an afternoon.

### The decision I got wrong, and only found by running it

`ADR-0007` was written before any report existed. It said rankings must sort by the lower bound of a
Wilson interval rather than by observed rate, so that a cuisine with two establishments and one poor
result does not outrank one with four hundred — and it claimed small samples would "sink under their
own uncertainty".

Then it ran against all 23,528 establishments:

| Sorted by supported floor (shipped) | n | observed | supported |
|---|---|---|---|
| Basque | 2 | 50.00% | 9.45% |
| Latin American | 795 | 1.51% | 0.87% |
| Chinese | 1,736 | 1.09% | 0.70% |

**It works, and not as well as I said it would.** The naive ordering fills the top of the table with
groups of 31, 46 and 61; the shipped ordering replaces them with 795, 1,736 and 541 — a real
improvement. But Basque, at n=2, still tops the table, because the city-wide `Poor` rate is around
0.5% and the uncertainty on a sample of two stays an order of magnitude above a well-established
small number.

The interval turned *"50%, obviously first"* into *"9.45%, still first"*. That is a smaller lie, not
a true statement.

Two things changed as a result, and both were in the ADR as niceties before the measurement made them
load-bearing: `n` is a column rather than a footnote, and the table says in words that a small group
can sit at the top. The ADR now carries both orderings as measured tables and states the correction
as a correction.

The generalisable part: **an ADR written before the code is a hypothesis.** This one was right about
the mechanism and wrong about the magnitude, and nothing but running it on real data could have
distinguished those.

### Three bugs, each found by a test written before I believed there was a bug

- **A borough named in a link never framed the map.** The camera move was recorded as "handled"
  *before* checking that the borough's bounds had loaded — and since the vocabulary is fetched
  asynchronously, a `?locality=Brooklyn` link spent its one chance on a render where there was nothing
  to frame with.
- **A backwards date range silently showed different data.** It dropped both dates and re-ran, so the
  table reloaded as the *unfiltered* report while an error above it said the range was wrong. Real
  numbers, for a period nobody asked for. The request now freezes at the last valid one.
- **The report table's columns did not add up to its own total.** `noInspectionInPeriod` was in the
  CSV and not in the table — the exact reconciliation failure the response validator rejects a whole
  payload for.

None of these throw. All three produce a plausible screen.

### Where the documentation had silently stopped tracking the work

Two features shipped with thorough commit messages, thorough code comments, and **no milestone
document and no roadmap entry at all**. The largest decision behind them — named reports over a query
builder — existed only in a conversation.

Caught by being asked, not by noticing. That is worth recording plainly: the per-change discipline
held completely while the per-milestone discipline had lapsed, and they fail independently. Fixed by
writing M5b up and inserting it in the roadmap rather than renumbering M6 and M7, which are referred
to by number elsewhere.

### Where a rule from an earlier milestone paid for itself immediately

`TreatWarningsAsErrors` went on at the start of this milestone, on the argument that a warning nobody
reads is not a warning. Within an hour it failed a build over an xUnit analyser complaint —
`Assert.Single(x.Where(...))` — that would previously have scrolled past in CI output.

Small, and exactly the class of thing the change was for.

### What was delegated, and how it was verified

- **The Wilson interval**, checked against the published bound for 5 of 10 rather than against its own
  output — a test written by pasting what the code printed proves only that the code does what it
  does. The ranking property is asserted directly: the 400-establishment group must outrank the
  2-establishment one.
- **The borough bounding boxes**, measured from the establishments rather than taken from published
  borough outlines, with the outlier risk checked rather than assumed: zero establishments outside New
  York, zero at a zero coordinate, zero with coordinates and no locality.
- **The `popstate` handler**, verified by deleting the listener, watching the test fail, and putting it
  back.
- **186 backend tests, 229 web tests, 0 warnings**, and no new dependencies — including the router
  that was not added, and the `.xlsx` library that CSV made unnecessary.

### Where a human still has to look

- **The small-sample handling in every ranking report.** Named in the milestone doc's review list
  before it was written, and the measurement above is why.
- **`ProportionEstimate`** — a scoring rule, which `CLAUDE.md` puts in the same category as grading
  normalisation: wrong here is silent and inverts a conclusion while everything runs.

### Where I took the tool's word for it

- **That the report query is affordable.** It runs a correlated subquery per establishment across the
  whole table. It returns quickly on a warm local database with 23,528 rows; nobody has looked at the
  plan, and no report appears in `docs/performance.md`.
- **That the cuisine vocabulary means something.** 89 values, assigned by the source, uncurated. Every
  per-cuisine report inherits whatever inconsistency is in that field, and this project has not
  examined it.

### What I'd tell a junior

M5's lesson was that an instrument can report success while being structurally unable to observe the
failure. M5b's is the version that applies to *decisions*: **writing the reasoning down first does not
make it true, and the document is not finished until the thing it describes has been run.**

ADR-0007 was carefully argued, correct about the mechanism, and overstated in a way that changed what
the interface had to do. Fifteen minutes against real data was worth more than the hour spent writing
it — and the ADR is better for carrying the correction than it would have been if I had quietly
adjusted the claim.

Write the decision before the code. Then go and find out whether you were right, and record the answer
next to the question.
