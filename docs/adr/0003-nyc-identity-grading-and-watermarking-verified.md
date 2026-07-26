# ADR-0003 — Identity, grading and watermarking, verified against the NYC dataset

- **Status:** Accepted
- **Date:** 2026-07-25
- **Supersedes:** [ADR-0002](0002-per-source-connectors-and-a-canonical-schema.md)

> **Status note, added 2026-07-26.** This record repeatedly defers open questions to "M2", which at
> the time meant a Chicago connector. **M2 was cut** ([roadmap](../roadmap.md#m2--ingest-a-second-city--cut)) —
> the project is scoped to one source, deliberately. Read every reference to M2 below as *not
> planned* rather than *scheduled*.
>
> Nothing about the NYC findings changes: they were verified against live responses and stand on
> their own. What changes is that the Chicago-side claims inherited from ADR-0002 — its record grain,
> its grading vocabulary, whether establishment identifiers collide across cities — are now
> **permanently unverified** rather than pending. They should not be repeated as fact anywhere, and
> if a second source is ever added, this ADR and ADR-0002 both need reopening rather than assuming.

## Why this supersedes ADR-0002 rather than editing it

ADR-0002's *decision* — a connector per source, mapping into one canonical schema — still stands, and
nothing here overturns it. Its *context* did not: the four factual claims it rests on were written
from an assistant's recollection during M0, without either dataset being called. That was recorded at
the time in `docs/ai-engineering-log.md` as an open debt, to be settled at M1.

It has now been settled. Two of the claims survive, one is wrong, one was never checked at all, and
three facts nobody anticipated turn out to matter more than any of them. ADR-0002 stays in the
repository unedited because a decision record that gets quietly corrected is worth nothing — the
point of the format is that you can see what was believed, when, and on what basis.

All findings below come from live unauthenticated calls to
`https://data.cityofnewyork.us/resource/43nn-pn8j.json` on 2026-07-25, against 295,294 rows.

## What ADR-0002 claimed, and what is true

| ADR-0002 claim | Verdict | Evidence |
|---|---|---|
| NYC scores are lower-is-better | **Confirmed** | Mean score by grade: A 10.21, B 22.38, C 41.71 across 129,394 graded rows. Monotonic and unambiguous. |
| NYC issues letter grades A/B/C | **Wrong** | Six values exist: `A`, `B`, `C`, `N`, `Z`, `P`. |
| The letter grade is *derived from* the score | **Too strong** | Score ranges overlap heavily — grade `A` reaches score 43, grade `C` starts at 0. Grade depends on inspection process and re-inspection outcome, not on score alone. |
| Record grain differs between sources | **Confirmed for NYC** | NYC emits one row per violation: 295,294 rows across 31,180 establishments. (The Chicago half of this claim is still unverified — its schema has a `violations` text column consistent with the claim, but no value has been read. That debt moves to M2.) |
| Establishment identifiers are per-city and not globally unique | **Unverified** | Not testable from one source. Carried forward. |
| Some datasets are restated in place | **Confirmed, and worse than described** | See "No usable change-tracking field" below. |

Two things ADR-0002 did not mention that turn out to be load-bearing.

### Over half of all rows carry no grade at all

149,994 of 295,294 rows have a null `grade`. Grade is an attribute of a *graded inspection*, not of
every inspection or every violation row. Any model that treats grade as required, or that back-fills
it from score, will be wrong for the majority of the dataset.

Grade distribution, rows with a grade: A 98,149 · B 18,054 · C 13,195 · N 10,245 · Z 4,854 · P 803.

### A sentinel date encodes "permitted but never inspected"

3,606 rows carry `inspection_date = 1900-01-01`, with no action, no score, no grade, no violation,
and no cuisine — but with a name, phone, full address and coordinates. These are establishments that
hold a permit and have not yet been inspected.

This is not a defect to filter out. It is the "newly licensed, no history" signal the product is
partly built on, and it arrives inside the inspection dataset rather than requiring a separate
licence feed. It must be modelled as an establishment with zero inspections, never as an inspection
dated 1900.

## Decision 1 — Identity

`(SourceId, ExternalId)` remains the identity for every canonical entity, as ADR-0002 specified. NYC
forces one addition: **it publishes no inspection identifier.** There is no `inspection_id` column.
Only the establishment has a source-issued key (`camis`).

So for NYC the connector *derives* external ids:

| Entity | ExternalId | Source |
|---|---|---|
| Establishment | `camis` | issued by NYC |
| Inspection | `camis:inspection_date:inspection_type` | derived |
| Violation | `camis:inspection_date:inspection_type:violation_code` | derived |

A derived key is a liability and is recorded as one: if NYC re-words an `inspection_type` string, every
derived id under it changes and those inspections re-insert as new rows rather than updating. The
alternative — a surrogate key plus a lookup on the business columns — moves the same fragility into a
query instead of a string, and is harder to debug. Accepted with the risk stated. If a re-wording is
ever observed, the fix is a per-source mapping of inspection-type text to a stable code, and that
needs its own ADR.

**This key was verified, and the verification is the interesting part.** Across the Staten Island
slice that M1 actually ingests, `(camis, inspection_date, inspection_type, violation_code)` has zero
collisions. Across the full city it has **140 colliding groups, 280 rows**. A unique index built on
the strength of the slice alone would have passed every test in M1 and failed the first time the
scope widened to a second borough.

Inspecting the collisions: they are exact duplicates. Grouping by the natural key returns 140 groups;
re-grouping with `score`, `grade`, `action` and `critical_flag` added also returns 140 — the extra
columns split nothing, so the duplicated rows agree on every field that feeds normalisation.
Deduplicating on the natural key is therefore lossless, not a silent data loss.

**Consequence:** the connector deduplicates within a batch before upserting, and the database carries a
unique index on the natural key. The source itself is not idempotent; ours is.

## Decision 2 — Grading normalisation

Store the source's own values, translate for comparison, and never compute one from the other.

- `RawGrade` (`string?`) and `RawScore` (`int?`) are persisted exactly as published.
- A normalised `InspectionOutcome` is derived **from the grade when one is present**, and is
  `Ungraded` when it is not. It is never inferred from the score, because the score does not determine
  the grade.
- A normalised `NormalisedSeverity` (0–100, **higher is worse**, documented once here and asserted in
  tests) is derived from the score for sources that publish one. NYC's score is already
  higher-is-worse, so NYC's translation is the identity function — which is exactly the case most
  likely to hide a sign error, because a bug and a correct implementation produce the same output.
  The direction is therefore pinned by a test using a fixture from a real grade-A response and a real
  grade-C response, asserting that the A establishment scores *less severe* than the C. That test
  fails if the direction is ever inverted, in this connector or a future one.

`N`, `Z` and `P` are mapped explicitly rather than lumped into a default branch: `N` and `Z` are
not-yet-resolved states, `P` is a pending re-inspection following a closure. Mapping them to
"ungraded" is a decision, not an accident, and the mapping is a `switch` with no default arm so that a
seventh grade value appearing in the source becomes a compile-or-test failure rather than a silent
reclassification.

## Decision 3 — Watermarking

**`record_date` cannot be the watermark.** It has three distinct values across all 295,294 rows, all
stamped within six seconds of one another on 2026-07-24 at 06:00. It is the timestamp of the
portal's whole-dataset extract, not a per-row change time. Watermarking on it would re-fetch the
entire dataset on every run and would still never reveal which rows had changed.

That leaves no per-row change-tracking field at all. `inspection_date` is an *event* date: when a
previously published inspection is corrected or re-graded, its `inspection_date` does not move, so the
corrected row sits permanently below any watermark set from it.

**The mechanism: a watermark with a lookback window.** Persist the highest `inspection_date` ingested.
On the next run, request everything from `watermark − lookback` rather than from `watermark`. The
overlap is deliberate: it is the only way to see restatements of records already held.

The lookback is configured, not hard-coded, and defaults to 30 days. That number is a starting
assumption, not a measurement — nothing has yet established how far back NYC actually restates rows.
Measuring it is a follow-up, and until it is measured the value should be read as "a guess we can
change," not as a finding.

This is what makes idempotency structural rather than defensive. Every run *deliberately* re-fetches
data it already holds. If the upsert on `(SourceId, ExternalId)` were wrong, the row count would grow
on every single run, not just on an unlucky overlap. The M1 test that asserts a stable row count
across two runs of the same window is therefore testing the mechanism the design depends on, not a
hypothetical edge case.

## Alternatives considered

**Filter out the 1900 sentinel rows at ingest.** Rejected: it discards the newly-licensed signal,
which is one of the three scoring inputs the product is built on. They are modelled as establishments
with no inspections.

**Derive the letter grade from the score.** Rejected on the evidence above — the ranges overlap, so
any threshold produces wrong grades for real rows. Both fields are stored.

**Use `record_date` as the watermark because it is named like one.** Rejected on the evidence above.
Recorded here because the field name is genuinely misleading and the next person to look at this
schema will have the same idea.

**Full re-ingest on every run instead of a watermark.** Defensible at 295,294 rows and honestly
tempting at M1's slice of 3,099. Rejected because the milestone exists to build the incremental
mechanism, and because a full re-ingest stops being viable at the point the project claims to scale to
many cities. The lookback window gets most of the correctness benefit of a full re-ingest at a small
fraction of the cost.

**Dedupe by discarding the second row without checking.** Rejected in favour of verifying that
duplicates carry identical values first. They do, so the dedupe is lossless; had they differed, the
correct behaviour would have been to keep both under a wider key or to record the conflict.

## Consequences

- The connector cannot be written from the dataset's documentation alone. Three of the decisions here
  came from querying values, not from reading column names — and one of them (the natural key) would
  have come out the opposite way if only the M1 slice had been queried.
- Grade and score are stored raw *and* normalised. That is deliberate duplication: the raw values make
  a mapping bug fixable by re-normalising stored data, per ADR-0002's retention rule.
- The 30-day lookback is an unmeasured default and is flagged as such in the code, in the log and here.
- Chicago's grain and grading remain unverified. M2 tests them, and this ADR should be revisited then
  rather than assumed to generalise.
