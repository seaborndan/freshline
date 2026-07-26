# ADR-0002 — Per-source connectors mapping into one canonical schema

- **Status:** Accepted — decision stands, context superseded, generalisation unexercised
- **Date:** 2026-07-25
- **Context superseded by:** [ADR-0003](0003-nyc-identity-grading-and-watermarking-verified.md) (2026-07-25)

> **Status note, added 2026-07-26.** Two things a reader should know before taking the Context
> section below at face value.
>
> **First: its factual claims were checked and are partly wrong.** They were written from an
> assistant's recollection during M0 without either dataset being called. ADR-0003 records what
> survived — NYC's grading direction did; "grades are A/B/C" did not, there are six values; and the
> grade is not derivable from the score. The text below is left exactly as written, because a
> decision record that gets quietly corrected is worth nothing.
>
> **Second: the decision is now applied to one source and will stay that way.** The second city that
> would have tested whether this design generalises was cut before it was started
> ([roadmap](../roadmap.md#m2--ingest-a-second-city--cut)). `ISourceConnector` has exactly one
> implementation. The reasoning below for *why* a connector-per-source beats a config-driven generic
> ingester still holds on its own terms — and it is reasoning, not evidence. Nothing here has been
> demonstrated by a second implementation, and it should not be described as though it had been.

## Context

Freshline's entire value proposition is that it joins data no one else joins: health-inspection and licence
records from many cities, made comparable. That means the ingestion layer is not a detail — it *is* the
product, and the shape it takes determines whether adding the fifth city takes an afternoon or a week.

The sources are superficially similar and substantively very different. They are almost all Socrata portals
with the same HTTP surface, which makes them look interchangeable. They are not:

- **Different grading systems.** New York issues letter grades (A/B/C) derived from a numeric score where
  *lower is better*. Chicago publishes a pass / pass-with-conditions / fail result and no score at all. Other
  jurisdictions publish a numeric score where *higher is better*. These cannot be compared without an explicit
  per-source translation, and getting the direction backwards would silently invert the product's core signal.
- **Different record grain.** Some portals emit one row per violation, so a single inspection appears as many
  rows that must be grouped. Others emit one row per inspection with violations packed into a text field that
  has to be parsed.
- **Different identity.** Establishment identifiers are per-city and not globally unique. A restaurant that
  closes and reopens under new ownership may keep or lose its identifier depending on the city.
- **Different update semantics.** Some datasets are append-only; some are restated in place, meaning a record
  fetched last week may have changed without any new row appearing.

Whatever ingestion looks like, it has to survive all four of those differences without the differences leaking
into the scoring logic or the API.

## Decision

Each source gets its **own connector class**, written in C#, implementing a common interface. A connector is
responsible for fetching, paging, and translating that source's records into the canonical model — including
normalising the grading system into a single internal scale with a documented direction.

The canonical model (`Establishment`, `Inspection`, `Violation`) is the only shape anything downstream sees.
Scoring, the API, and the front end have no knowledge of which city a record came from beyond it being an
ordinary attribute.

Every canonical row retains provenance: which source it came from, that source's own identifier for it, when
it was fetched, and the raw payload it was derived from. Identity is `(SourceId, ExternalId)`, which is unique
by construction and makes ingestion idempotent — re-running a window updates rather than duplicates.

## Alternatives considered

**One generic ingester driven by a JSON field-mapping configuration.** This was the initial instinct, and it
is wrong. Field mapping handles the easy 20% — that `dba` in one city is `business_name` in another. It cannot
express "letter grade derived from a score where lower is better," or "group these eleven rows into one
inspection with eleven violations," or "this field is a free-text blob that needs parsing." Attempting it
produces a configuration language that is a worse programming language than C#, with no type checking, no
debugger, and no tests. Rejected.

**A table per city, queried with UNION.** Rejected: it makes adding a city a schema migration, makes every
cross-city query a UNION over a growing list, and makes the scoring model — which is inherently cross-city —
impossible to express cleanly. It also defeats the spatial index, since the index would be per-table.

**Store raw source payloads only, and normalise at query time.** Rejected: it moves an expensive,
source-specific transformation into the hot path of every user request, and the normalisation logic would then
be duplicated across every consumer. Normalising on write, once, is correct here because reads vastly outnumber
writes.

**Use an off-the-shelf ETL tool (Data Factory, Airbyte).** Rejected for this project specifically: the
transformation is the interesting part and the part worth being able to explain, and delegating it to a
low-code tool would remove the thing the project exists to demonstrate. This is a judgement about the project's
purpose, not a claim that these tools are wrong in general — for a team shipping this commercially, Data
Factory would be a defensible choice.

## Consequences

- Adding a city costs one connector class and its tests. That is the intended cost and it is honest work, not
  configuration.
- The normalisation of grading systems is the highest-risk logic in the system: a sign error inverts the
  product's meaning while everything continues to run. It needs direct unit tests with known fixtures per
  source, and those tests are non-negotiable.
- Retaining raw payloads costs storage. At the volumes here that is cheap, and it means a mapping bug can be
  fixed by re-normalising from stored data rather than re-fetching from every source.
- `(SourceId, ExternalId)` as the natural key means a genuinely new establishment reusing a retired city
  identifier would be silently merged into the old record. This is a known, accepted gap at this stage. If it
  proves real in the data, the fix is to include a first-seen date in the identity, and that would need a new
  ADR.
