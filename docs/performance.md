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
