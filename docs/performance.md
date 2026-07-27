# Query performance

Real measurements or nothing. Every number here came from `SET STATISTICS IO, TIME` against the
actual database; nothing is estimated, and the one place a first reading turned out to be misleading
is called out rather than quietly replaced.

The headline finding is not the one this milestone expected to produce: **the spatial index did not
make the map query faster. It made it slower.** What made it faster was a covering index and a
change to the query's shape. The spatial index earns its place somewhere else entirely.

---

## What was measured

**The map list query.** Establishments inside a viewport, each with the grade and severity of its
most recent inspection, top 50 by severity. It is the query behind the main screen, so it is the one
worth being fast.

**Environment.** SQL Server 2022 in Docker on a development laptop. Single user, warm cache, no
concurrent load. Reported as-is; see [Limits](#limits-of-these-numbers) before drawing conclusions
from the absolute values.

**Data.** 23,528 establishments (23,017 with coordinates), 29,601 inspections, 94,400 violations.
The `Establishments` clustered index is about 1,408 pages — roughly 11 MB. That figure turns out to
explain most of the result.

**Viewport.** Latitude 40.700–40.775, longitude −74.020 to −73.960: lower and midtown Manhattan plus
part of Brooklyn. **7,290 of 23,528 establishments, or 31%.**

**Metric.** Logical reads and CPU time. Elapsed time at this data size is dominated by timer
resolution and scheduling noise — several readings came back as `0 ms` — so it is reported where
useful but nothing is concluded from it. Logical reads are deterministic and reproduce exactly
across runs; CPU is stable to within a few milliseconds.

---

## The map list query: before and after

### Before

```sql
SELECT TOP (50) e.Id, e.Name, e.Cuisine, e.AddressLine,
    LatestGrade    = (SELECT TOP 1 i.RawGrade           FROM Inspections i
                      WHERE i.EstablishmentId = e.Id ORDER BY i.InspectedOn DESC),
    LatestSeverity = (SELECT TOP 1 i.NormalisedSeverity FROM Inspections i
                      WHERE i.EstablishmentId = e.Id ORDER BY i.InspectedOn DESC)
FROM Establishments e
WHERE e.Latitude BETWEEN @minLat AND @maxLat
  AND e.Longitude BETWEEN @minLon AND @maxLon
ORDER BY LatestSeverity DESC;
```

### After

> **⚠ This query is wrong, and M4 found out how.** `CROSS APPLY` is an inner join: an establishment
> with no inspections vanishes from the result. Against this viewport that silently dropped **1,307
> of 7,290** establishments — the never-inspected ones, which are the signal the product is partly
> built on. The measurement below is real and the reasoning about *why* it got faster still holds,
> but the query should be `OUTER APPLY`. See [The establishment list query](#m4--the-establishment-list-query)
> for the correction and what it costs. The block is left as written rather than edited, because a
> quietly corrected number is indistinguishable from one that was never wrong.

```sql
SELECT TOP (50) e.Id, e.Name, e.Cuisine, e.AddressLine,
       latest.RawGrade, latest.NormalisedSeverity
FROM Establishments e
CROSS APPLY (
    SELECT TOP 1 i.RawGrade, i.NormalisedSeverity
    FROM Inspections i
    WHERE i.EstablishmentId = e.Id
    ORDER BY i.InspectedOn DESC
) AS latest
WHERE e.Latitude BETWEEN @minLat AND @maxLat
  AND e.Longitude BETWEEN @minLon AND @maxLon
ORDER BY latest.NormalisedSeverity DESC;
```

plus one index change:

```sql
-- was: (EstablishmentId, InspectedOn)
CREATE INDEX IX_Inspections_EstablishmentId_InspectedOn
ON Inspections (EstablishmentId, InspectedOn DESC)
INCLUDE (RawGrade, NormalisedSeverity);
```

### Result

| | Establishments reads | Inspections reads | Total logical reads | CPU |
|---|---|---|---|---|
| Original query, original index | 1,478 | 65,058 | **66,536** | 78 ms |
| Original query, covering index | 1,408 | 31,050 | **32,458** | 13–18 ms |
| `CROSS APPLY`, covering index | 1,408 | 15,525 | **16,933** | ~15 ms |

**3.9× fewer logical reads**, and CPU from 78 ms to roughly 15 ms.

Execution plans: [`plans/map-list-query-before.sqlplan`](plans/map-list-query-before.sqlplan) and
[`plans/map-list-query-after.sqlplan`](plans/map-list-query-after.sqlplan). Open them in SSMS or
Azure Data Studio. The difference is visible without reading any numbers: the before plan contains
**two** Nested Loops joins feeding two separate index seeks, the after plan contains one.

### Where each gain came from

**The covering index halved it.** `Inspections` scan count stayed at 14,580 but reads dropped from
65,058 to 31,050. The old index could seek to an establishment's inspections in date order, but did
not carry `RawGrade` or `NormalisedSeverity` — so every matched row then had to be fetched from the
clustered index. `INCLUDE` puts those two columns in the index leaf and the lookup disappears.

**`CROSS APPLY` halved it again.** Scan count fell from 14,580 to 7,290 — exactly half, and exactly
the number of establishments in the viewport. The original query asked the same question twice: one
correlated subquery for the grade, another for the severity, each independently seeking to the same
row of the same table. `CROSS APPLY` asks once and returns both columns.

That second one is worth internalising. It is not really an indexing problem — it is a query that
says the same thing twice, and the cost scales with how many columns you want from the related row.
A third subquery for `InspectedOn` would have made it three seeks per establishment.

**A note on measurement order.** The 66,536-read figure was taken before the covering index existed.
When the naive query was re-run afterwards it improved on its own, to 32,458. Both numbers are real,
but attributing the whole 3.9× to the rewrite would have been wrong — the honest split is roughly
half from the index and half from the query shape. This is the argument for changing one thing at a
time and re-measuring after each, rather than making several changes and measuring once at the end.

---

## The spatial index: the finding that was not expected

A `geography` column with a spatial index was added in the same milestone, on the assumption that
"what is in this part of the map" is a spatial question and should therefore use a spatial index.

Measured against the same viewport, with the covering index in place for both:

| Viewport predicate | Establishments reads | Inspections reads | Spatial index reads | Total | CPU |
|---|---|---|---|---|---|
| `Latitude/Longitude BETWEEN` | 1,408 | 15,525 | – | **16,933** | 15 ms |
| `@viewport.STIntersects(Location) = 1` | 22,934 | 15,525 | 1,900 | **40,359** | 24 ms |

**The spatial index made the query 2.4× more expensive.**

The reason is in the `Establishments` row. The bounding-box version scans the clustered index once —
1,408 pages, the entire table, about 11 MB. The spatial version seeks the spatial index, gets 7,290
candidate rows, and then performs 7,290 individual key lookups back into the clustered index at
roughly three reads each.

At 31% selectivity, one sequential pass over a small table beats seven thousand random lookups. This
is the ordinary index tipping point, and a spatial index is subject to it like any other.

Narrowing the viewport to a few blocks — 252 establishments, about 1% — closes the gap but does not
reverse it:

| Tight viewport (252 rows) | Establishments | Inspections | Spatial | Total | CPU |
|---|---|---|---|---|---|
| Bounding box | 1,408 | 539 | – | **1,947** | 0 ms |
| Spatial | 1,123 | 555 | 260 | **1,938** | 2 ms |

A wash. **At this data size the spatial index does not pay for itself on viewport queries at any
selectivity tested.**

---

## Where the spatial index does earn its place

Radius search — "everything within 500 m of this point" — is a question a bounding box cannot ask.
A box is a square; a radius is a circle; and no combination of `BETWEEN` clauses produces a circle.

```sql
DECLARE @centre geography = geography::Point(40.7220, -74.0010, 4326);
SELECT TOP (50) e.Id, e.Name, Metres = @centre.STDistance(e.Location)
FROM Establishments e
WHERE e.Location IS NOT NULL AND @centre.STDistance(e.Location) <= 500
ORDER BY Metres;
```

| | Logical reads | CPU |
|---|---|---|
| Spatial index forced off (`WITH (INDEX(0))`) | 1,478 | **101–136 ms** |
| Spatial index allowed | 1,452 | **0 ms** |

Reads are effectively identical. **CPU collapses from over 100 ms to unmeasurable.**

That inverts the lesson from the viewport query, and it is the more interesting result. The cost of
a radius search is not reading pages — it is evaluating `STDistance` 23,017 times, once per row.
The spatial index does not save I/O here; it eliminates the computation, by answering from a grid
tessellation instead of calling a geometry function per row.

Two different bottlenecks, two opposite conclusions, one index. Reads were the right metric for the
first query and would have shown nothing at all for the second.

Worth noting: SQL Server matched `STDistance(...) <= 500` to the spatial index on its own. Rewriting
the predicate as `@centre.STBuffer(500).STIntersects(...)` produced an identical plan and identical
reads, so the rewrite some guidance recommends was unnecessary here.

---

## M4 — the establishment list query

Measured 2026-07-26, same environment and same data as above. This is the paged list behind the
map's side panel: establishments ordered by name, each with the outcome of its most recent
inspection, filtered by cuisine, borough, latest outcome, name prefix and whether the establishment
has ever been inspected.

### First, a correctness bug that no timing would have caught

`CROSS APPLY` is an inner join. Counted across the whole table, not just the M3 viewport:

| | Rows |
|---|---|
| `SELECT COUNT(*) FROM Establishments` | 23,528 |
| Same, via `OUTER APPLY` to the latest inspection | 23,528 |
| Same, via `CROSS APPLY` to the latest inspection | **19,923** |

**3,605 establishments disappear** — exactly the count awaiting a first inspection. The query runs,
returns thousands of rows, and looks entirely healthy. Nothing in a performance measurement would
ever have surfaced it, because the fastest way to answer a question is to answer less of it.

The list endpoint uses left-join semantics and returns those rows with a null `latestInspection`.
An end-to-end walk of the live endpoint returns **23,528 rows over 118 pages of 200, with zero
duplicates and zero skips**, which is both the paging assertion and the proof that nothing is being
dropped.

### Keyset paging, and what the index does

The query is EF Core's, captured from the application's own SQL log rather than hand-written, so
these are the numbers the running API produces. EF translates the seek predicate to:

```sql
WHERE [e].[Name] > @after_Name OR ([e].[Name] = @after_Name AND [e].[Id] > @after_Id)
```

and the latest-inspection lookup — written in LINQ as a correlated `FirstOrDefault` — not to
`OUTER APPLY` but to a `LEFT JOIN` onto a `ROW_NUMBER() OVER (PARTITION BY EstablishmentId ...)`
window filtered to `row <= 1`. That difference turned out to matter more than the seek predicate did.

**Before the M4 migration**, with only the M3 index set (page = 50 rows, so `TOP(51)`):

| Query | Establishments | Inspections | Worktable | Total |
|---|---|---|---|---|
| EF, page 1 | 1,478 | 1,469 | – | **2,947** |
| EF, page 100 (keyset) | 1,408 | 1,401 | – | **2,809** |
| Hand-written `OUTER APPLY`, page 100 (keyset) | 1,408 | 325 | – | **1,733** |
| Hand-written `OUTER APPLY`, page 100 by `OFFSET` | 1,478 | 1,401 | 91,694 | **94,573** |

Two things stand out. `OFFSET` is catastrophic — 91,694 of those reads are a worktable, the sort
that produces and discards 4,950 rows to reach row 4,951. And EF's window-function form reads the
whole `Inspections` clustered index every time, 1,401 pages regardless of how many rows the page
actually needs.

### The index changes, measured one at a time

**Is `(Name, Id)` better than `(Name)`?** No — measurably not. `Id` is the clustered key, which SQL
Server already carries in the leaf of every nonclustered index, so `(Name)` is physically stored in
the same order. Both measured **171** logical reads on the establishment side at page 100. The
composite is kept anyway, as documentation of the ordering the cursor depends on, and this table is
the reason that choice is honest rather than a claim it is faster.

**Does `INCLUDE` pay?** Yes, and by more than expected.

| `Establishments` index at page 100 | Est. reads | Index size |
|---|---|---|
| No `Name` index at all | 1,408 | – |
| `(Name)` | 171 | – |
| `(Name, Id)` | 171 | 1,352 KB |
| `(Name, Id)` `INCLUDE` the list projection | **21** | 2,696 KB |

**And widening the M3 `Inspections` INCLUDE:** the M3 index covered `RawGrade` and
`NormalisedSeverity`, which is what the M3 query selected. The list also reads `Outcome` and
`ClosedByAuthority`, and each missing column puts the key lookup back.

| `IX_Inspections_EstablishmentId_InspectedOn` | Insp. reads | Index size |
|---|---|---|
| M3 `INCLUDE (RawGrade, NormalisedSeverity)` | 325 | 744 KB |
| M4 `INCLUDE (… , Outcome, ClosedByAuthority)` | **102** | 888 KB |

### After both index changes

| Query | Establishments | Inspections | Total |
|---|---|---|---|
| EF, page 1 | 16 | 111 | **127** |
| EF, page 100 (keyset) | 21 | 111 | **132** |
| Hand-written `OUTER APPLY`, page 1 | 16 | 102 | **118** |
| Hand-written `OUTER APPLY`, page 100 | 21 | 102 | **123** |

**EF's plan went from 2,809 reads to 132 — 21× — and the gap to hand-written SQL closed to 7%.**

That reverses a conclusion that looked solid an hour earlier. Against the M3 index, EF's generated
SQL cost 1.6× the hand-written `OUTER APPLY`, and the obvious inference was that this query should
drop to raw SQL. It should not. The window function was expensive because it was scanning the
*clustered* index; once a narrow covering index could answer it, the same plan became nearly free.
**The fix was the index, not the ORM.**

### Cost against depth — the property keyset paging is chosen for

`Establishments` logical reads, EF's SQL, same page size, five positions. `Inspections` is a constant
111 in every row of this table and is omitted.

| Page (row) | Keyset | `OFFSET` |
|---|---|---|
| 1 (row 1) | 16 | 16 |
| 21 (row 1,001) | 20 | 28 |
| 100 (row 4,951) | 21 | 78 |
| 201 (row 10,001) | 21 | 142 |
| 461 (row 23,001) | **9** | **307** |

Keyset is flat. `OFFSET` grows linearly with depth, because the rows before the page still have to be
produced and thrown away. The last row of the keyset column is lower than the others because only 528
rows remain past that point, so `TOP(51)` finishes inside a shorter range — the cost tracks the size
of the page, which is the whole idea.

**A measurement that was wrong first.** The first version of this table showed keyset and `OFFSET`
identical at every depth. The cause was the harness, not the queries: the test script wrapped the
seek in `WHERE @nm IS NULL OR [e].[Name] > @nm ...` so one script could serve both the first page and
later ones. That predicate is not sargable — a condition that might be true for every row cannot be
used to seek — so SQL Server scanned in both shapes and the difference vanished. Rebuilding each
statement with the exact predicate EF emits produced the table above. Worth stating because the wrong
version was self-consistent, reproducible, and would have been believed.

### What is still true and unresolved

EF's window-function form scans the whole `Inspections` covering index once per query: **111 pages
today, and that number grows with the table, not with the page.** The hand-written `OUTER APPLY` does
51 seeks and stays near 102 regardless of how many inspections exist. At this size the difference is
7% and not worth raw SQL; at ten times the inspections the ORM's form would be reading roughly 1,110
pages to return 50 rows while `OUTER APPLY` still read about 102. **This is the number to re-measure
before M6, not a decision to revisit on taste.**

---

## M4 — the map viewport query

Same viewport as M3 — latitude 40.700–40.775, longitude −74.020 to −73.960, **7,290 establishments
with coordinates** — so the box is comparable even where the queries are not.

### The correctness fix is free

The obvious worry about replacing `CROSS APPLY` with `OUTER APPLY` is that keeping the unmatched rows
costs something. It does not. M3's query, unchanged apart from that one word:

| M3's query over the viewport | Establishments | Inspections | Total | Rows returned |
|---|---|---|---|---|
| `CROSS APPLY`, `TOP 50` by severity | 1,408 | 15,539 | **16,947** | 5,983 matched the box |
| `OUTER APPLY`, otherwise identical | 1,408 | 15,539 | **16,947** | 7,290 matched the box |

Identical cost, 1,307 more establishments. **The wrong answer was not buying any speed.** The 16,947
also reproduces M3's published 16,933 to within 14 reads — drift from inspections ingested since,
which is the sanity check that the M3 measurement was real and repeatable.

### The endpoint's own numbers, which are *not* comparable to M3

| | |
|---|---|
| `GET /establishments/map`, `limit=1000`, over the M3 viewport | **367** logical reads |

Set beside M3's 16,933 that looks like a 46× improvement. **It is not, and should never be quoted as
one.** The two queries answer different questions: M3 returned the 50 worst-scoring establishments in
the box, ordered by severity; this returns up to 1,000 pins ordered by primary key, with a different
projection and a different join strategy. Only the viewport is shared.

### Where the difference actually comes from — a crossover worth knowing

Holding the viewport, the row count, the projection and the filters constant, and changing **only**
how the latest inspection is fetched:

| Latest-inspection strategy, `TOP 1001` over the viewport | Establishments | Inspections | Total |
|---|---|---|---|
| EF's `ROW_NUMBER() OVER (PARTITION BY …)` window | 256 | **111** | **367** |
| Hand-written `OUTER APPLY` | 256 | **2,021** | **2,277** |

**The window function is 18× cheaper here** — the exact reverse of what the list endpoint showed,
where `OUTER APPLY` at 102 reads narrowly beat the window's 111 for a page of 50.

Both numbers are explained by one sentence: **`APPLY` costs roughly two reads per row returned;
the window function costs one pass over the covering index, about 111 reads, regardless of how many
rows come back.** So the crossover sits near 55 rows. Below it, seek per row; above it, scan once.

That is why the list and the map — which look like the same query with a different `WHERE` clause —
land on opposite sides of an argument, and why "`OUTER APPLY` is the right way to get the latest per
group" is only true for small result sets. Both endpoints are in LINQ and EF emits the window form
for both, which is the wrong choice for the list by 9 reads and the right one for the map by 1,910.

### What the endpoint refuses

Validation is measured against the data rather than picked: every establishment in the database falls
inside **0.41° of latitude by 0.55° of longitude**, so a viewport is capped at 1.0° on each axis —
already larger than anything that could return more. Missing bounds, inverted bounds, out-of-world
bounds and an out-of-range limit are each a distinct `400`. A viewport holding more than the limit
returns `isTruncated: true` rather than a silently partial map.

---

## Decisions taken from this

1. **The map list query uses a bounding box, not a spatial predicate.** Measured, not assumed.
2. **The covering index stays**, and is defined in
   `InspectionConfiguration` with a comment explaining what each part of it buys.
3. **The spatial index stays**, despite not helping the query it was added for, because radius search
   is a real requirement for territories at M6 and it is the only way to serve it. That is a
   judgement about a feature that does not exist yet, and it is flagged as one.
4. **The old composite index on `(Latitude, Longitude)` was dropped.** It indexed two nullable floats
   and nothing queried it. A B-tree over two independent columns cannot answer a two-dimensional
   range query anyway: it can seek on the first and must then scan every row in that band.
5. **Every latest-inspection lookup is a left join, never `CROSS APPLY`.** M4, and the reason is
   correctness rather than speed: the inner join dropped 3,605 rows without failing.
6. **The list endpoint pages by cursor, not by `OFFSET`.** M4. Flat cost with depth, measured.
7. **`IX_Establishments_Name_Id` covers the list projection**, and the `Inspections` covering index
   was widened by two columns. M4, both measured before and after.
8. **The list query stays in LINQ.** M4. The case for hand-written SQL evaporated once the index
   covered the window function; 7% does not buy back the loss of composable filters.
9. **The map query stays in LINQ too, and for the opposite reason.** M4. At 1,000 rows EF's window
   function beats hand-written `OUTER APPLY` by 18×, because `APPLY` costs ~2 reads per row while the
   window costs one index pass. The crossover is near 55 rows.
10. **The map endpoint is not paged.** M4. A cursor is for walking a list to its end; a map client
    pans, and a viewport it has left is not worth resuming. It reports truncation instead.

---

## Limits of these numbers

Stated plainly, because a benchmark without its caveats is decoration.

- **Warm cache throughout.** No cold-cache measurement was taken. Physical reads were zero in every
  run, so these figures describe a server whose working set is already in memory.
- **One user, one laptop, one container.** No concurrency, no network latency between application and
  database, no other load. Absolute timings are not transferable to a deployed environment.
- **23,528 establishments is small.** The whole table is roughly 11 MB. Scanning it is cheap, and that
  cheapness is precisely why the spatial index loses the viewport comparison. At ten times the data
  the conclusion could reverse, and nothing here should be quoted as though it would not.
- **Elapsed time is not used to conclude anything.** At this scale it is mostly noise; several
  readings were `0 ms`. Where CPU exceeds elapsed, the plan went parallel.
- **One viewport, one radius, one query.** Filters that a real user will apply — cuisine, grade,
  score band — were not part of the measurement and will change the plans.
- **The M4 list numbers are for the unfiltered list.** Every filter measurement was a correctness
  check, not a cost one: no logical-read figure here describes `?cuisine=Pizza&locality=Bronx`, and
  neither `Cuisine` nor `Locality` is indexed. A filter that is selective enough to matter will
  produce a different plan than any table above.
- **The `outcome` filter is unmeasured and is the one most likely to be slow.** It compares against
  the latest inspection, which EF translates to a correlated subquery per row. It is correct — there
  is a test proving it matches the latest inspection rather than any past one — but nobody has looked
  at what it costs.
- **The 10 seconds to walk all 118 pages is wall-clock over HTTP on one machine**, including JSON
  serialisation and the test client. It is a sanity check that paging terminates, not a latency
  benchmark, and nothing should be concluded from it about per-request latency.
- **No tuning of the spatial index was attempted.** `GEOGRAPHY_AUTO_GRID` with default
  `CELLS_PER_OBJECT`. Hand-picking grid levels before measuring would have been four guessed numbers.

## Reproducing this

```bash
docker compose up -d --wait
dotnet ef database update --project src/Freshline.Infrastructure
ConnectionStrings__Freshline="..." Ingestion__RunOnce=true dotnet run --project src/Freshline.Ingestion
```

Then run the queries above with `SET STATISTICS IO ON; SET STATISTICS TIME ON;`. Row counts will
differ as NYC publishes new inspections, so the absolute numbers will drift; the ratios are the part
that should hold.
