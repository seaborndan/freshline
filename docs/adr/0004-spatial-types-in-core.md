# ADR-0004 — NetTopologySuite in Core, and a bounding box in the map query

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

M3 added a `geography` column with a spatial index so the map can ask "what is in this part of the
map". Two decisions came out of it that are worth recording rather than commenting.

### The rule this bends

`CLAUDE.md` says `Freshline.Core` has no dependency on EF Core, ASP.NET, HTTP clients or any Azure
SDK, and that "if something in Core needs a package reference to compile, it probably belongs in
Infrastructure."

Putting a spatial point on `Establishment` means a `NetTopologySuite` reference in Core — the first
package reference that project has ever had.

### The alternative

Keep Core free of it and configure the column as an EF **shadow property**: it exists in the database
and in the model, but not on the entity class. Queries then reach it through
`EF.Property<Point>(establishment, "Location")`.

## Decision

**NetTopologySuite is referenced from Core, and `Establishment.Location` is a real property.**

The rule is aimed at *infrastructure* leaking into the domain — persistence, transport, hosting,
cloud SDKs. NetTopologySuite is none of those. It is a geometry library with no transitive
dependencies of its own, no I/O, and no knowledge of how or whether anything is stored. The EF Core
integration that maps it to SQL Server `geography` is a separate package and stays in Infrastructure,
which is where the actual persistence concern lives.

The positive case: this product's central question is "what is in this part of the map, matching
these filters". A point is domain vocabulary here in a way that a `DbContext` never is. M6's scoring
and saved territories are both spatial concepts, and expressing them through
`EF.Property<Point>(e, "Location")` would mean the domain could not state its own central concept in
its own types.

The trade the shadow-property alternative offers is a cleaner rule for stringly-typed, harder-to-test
code in every consumer. That is the wrong side of "prefer the explainable implementation over the
clever one".

**Coordinate order is written down once**, in `GeoPoint.FromLatitudeLongitude`, because the two APIs
that write this column take their arguments in opposite orders: T-SQL's `geography::Point` is
(latitude, longitude); NetTopologySuite's `Point` constructor is (X, Y), which is (longitude,
latitude). Reversing them throws nothing and moves every New York restaurant to the Southern Ocean.
It is pinned by unit tests and by an integration test that compares the stored geography against the
published latitude and longitude for every row.

## Decision 2 — the map list query uses a bounding box, not the spatial index

Measured in [`docs/performance.md`](../performance.md): against a viewport holding 31% of
establishments, the spatial predicate cost **40,359 logical reads against 16,933** for a plain
`BETWEEN` on latitude and longitude. Narrowing to 1% made it a wash, not a win.

The cause is ordinary. `Establishments` is about 1,408 pages; scanning it once is cheaper than
seeking a spatial index and then performing 7,290 key lookups back into the clustered index. A
spatial index hits the same selectivity tipping point every other index does.

**The spatial index is kept anyway**, because radius search — "everything within 500 m" — is a
question a bounding box cannot express, and there the same index takes CPU from over 100 ms to
unmeasurable by eliminating a per-row `STDistance` call. Saved territories at M6 need exactly that.

This is a decision to keep an index that does not help the query it was built for, justified by a
feature that does not exist yet. That is speculative, it is recorded as speculative, and if M6 is cut
or changes shape the index should be reconsidered rather than inherited.

## Alternatives considered

**Shadow property for `Location`.** Rejected above: preserves the letter of the rule at the cost of
every spatial query being stringly typed.

**A persisted computed column, `geography::Point(Latitude, Longitude, 4326)`.** Attractive because it
makes the duplication automatic and impossible to get out of step. Rejected because SQL Server will
not build a spatial index over a computed column, which defeats the purpose.

**Storing only latitude and longitude, and doing spatial maths in the application.** Rejected: it
moves a filter into the application that should reduce the result set inside the database, and it
makes "the 50 worst establishments in this area" require loading every establishment first.

**Dropping latitude and longitude now that `Location` exists.** Rejected. They are the values as
published, and ADR-0002's retention rule is that derived data must be re-derivable from what the
source actually said. `Location` is computed from them on write and never edited independently.

## Consequences

- Core has one package reference. Any second one should be argued for separately rather than treated
  as precedent — the argument here is specifically that geometry is domain vocabulary for this
  product, not that Core's dependency rule is soft.
- The spatial index costs storage and write throughput and currently earns neither back. That is
  accepted, measured, and written down.
- `Latitude`, `Longitude` and `Location` say the same thing twice. The runner derives the third from
  the first two on every write, and a test asserts they agree for every row in the database.
