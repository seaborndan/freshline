# Roadmap

Each milestone ends in something demonstrable. If work stops at M5, what exists is still a real
project rather than an abandoned scaffold — that ordering is deliberate.

Estimates are effort, not a schedule.

---

### M0 — Scaffold ✅ *(2026-07-25)*

Repo, solution layout, README written before any code, ADR-0001 and ADR-0002, `CLAUDE.md`, CI that
builds and tests both halves.

**Done when:** a stranger can read the README and understand the goal; CI is green.

> **Carried forward:** server-side branch protection is not enabled. GitHub requires Pro or a public
> repository for rulesets, and this repository is private while I am still employed elsewhere. A
> `.githooks/pre-push` hook refuses direct pushes to `main` as a local stand-in — a habit, not a
> control, since `--no-verify` bypasses it. **Enable a real ruleset the day this goes public**, along
> with a required status check on both CI jobs.

---

### M1 — Ingest one city ✅ *(2026-07-25)*

NYC DOHMH connector. Canonical `Establishment` / `Inspection` / `Violation` model, EF Core
migrations, SQL Server running locally in Docker. Incremental fetch with a watermark, idempotent
upsert on `(SourceId, ExternalId)`.

**Done when:** the ingester runs twice over the same window and the row count does not change. That
assertion is a test, not a manual check.

> **Scoped to one borough.** Staten Island, from 2025-07-25 — 3,237 rows, 899 establishments. The
> roadmap named NYC and NYC was the only verified source, but pointing a first connector at 295,294
> records before the model has been through one revision is the expensive order to do things in.
> Widening is a configuration change.
>
> **ADR-0002 was checked and partly wrong**, which is what M1 was supposed to find out. The
> superseding record is [ADR-0003](adr/0003-nyc-identity-grading-and-watermarking-verified.md).
>
> **Carried forward:** the 30-day lookback window is an unmeasured assumption — nothing has
> established how far back NYC actually restates records, and the number is not quoted anywhere as a
> finding. It is measurable without a second city: re-fetch a window already held and compare against
> the stored payloads to see how far back rows actually change.

---

### M2 — Ingest a second city — CUT

**Cut on 2026-07-26, before any work started.** Originally: a Chicago connector, to prove ADR-0002
right or wrong against a second grading system and a second record grain.

**Why it was cut.** The scope of one area, done all the way through to a deployed map, is already
the larger piece of work. Every milestone after this one — spatial queries, API, map UI, scoring,
infrastructure, observability — is exercised just as hard by one city's data as by three, and each
is worth more finished than a second connector is worth started. Cutting it moves M5, the milestone
that produces a URL worth putting on a résumé, roughly five hours closer.

**What is lost, stated plainly.** ADR-0002's central claim is that sources differ irreducibly and so
each needs its own connector. With one source that claim is *reasoned* rather than *demonstrated*.
The extension point exists, is behind an interface, and has exactly one implementation. Anywhere
this project describes itself, it says that — it does not describe itself as multi-source.

**What is not lost.** The grading-normalisation fixture tests were the genuinely valuable half of
this milestone, and they already exist for NYC: six grade values mapped explicitly, an unknown
seventh throws rather than defaulting, and the direction is pinned by a test against real captured
responses that was verified to fail when the direction is inverted.

**If it is ever revisited**, ADR-0002 and ADR-0003 both need reopening — ADR-0003's findings are
about NYC specifically, and nothing in them should be assumed to generalise.

---

### M3 — Spatial and query performance *(~5h)*

`geography` column with a spatial index. Bounding-box and radius queries. Then the deliberate part:
write the naive version of the main list query, measure it with a real execution plan, fix it,
measure again, and write both numbers down.

**Done when:** `docs/performance.md` holds a real before/after with plans. Real numbers or nothing.

---

### M4 — API *(~5h)*

ASP.NET Core Web API. Establishment list with filtering and keyset pagination, detail, and map
queries. OpenAPI documented. JWT auth. `ProblemDetails` on every failure path. Health check. Rate
limiting on anything expensive.

**Done when:** a stranger can explore live Swagger and every endpoint is correct on verbs, codes, and
error shape.

---

### M5 — Map UI *(~8h)* ← **the showable bar**

React + TypeScript with MapLibre GL. Establishments as clickable points coloured by status, with a
legend. Filter panel — city, cuisine, grade, score band. Detail panel with inspection history.
Loading, error, and empty states. Keyboard navigation.

**Done when:** someone can open the live URL, filter to an area, click a place, and understand what
they are looking at without being told. **The URL goes on the resume the day this deploys.**

> Deployment at this milestone is done by hand — Static Web Apps for the front end, App Service or a
> container for the API — and that is fine. M7 replaces it with Bicep and deploy-on-merge. Getting the
> thing in front of a human is worth more than getting the pipeline right first, and doing it manually
> once is what makes the M7 automation legible rather than copied.

---

### M6 — Scoring and territories *(~5h)*

The opportunity score: inspection trend, critical-violation recency, and whether an establishment is
newly permitted and not yet inspected. Saved territories, and a "what changed since you last looked"
view.

> The original wording said "licence age". There is no licence feed — that was going to come from a
> second dataset that is no longer in scope. The nearest real signal already in the data is the
> never-inspected sentinel: 118 establishments in the ingested slice hold a permit and have no
> inspection history, which is the same "brand new business" signal arriving by a different route.

**Done when:** the score is explainable field by field, and its weighting lives in one place that is
unit tested.

---

### M7 — Azure, IaC, CD *(~6h)*

Bicep for all infrastructure. GitHub Actions deploying on merge. Build once, deploy many. Key Vault
plus managed identity, OIDC for the deploy. Prove reproducibility by deleting the resource group and
redeploying from scratch.

**Done when:** merge to `main` deploys, and the whole environment can be recreated from an empty
subscription.

---

### M8 — Observability *(~4h)*

Application Insights across API and worker. Correlation IDs propagated from ingestion through to a
user request. A KQL dashboard: ingestion throughput, API latency percentiles, failure rate. One
documented SLO with the query that measures it.

**Done when:** one ingestion run can be traced end to end from a single id.

---

### M9 — Test hardening *(~5h)*

Integration tests against a real SQL Server via Testcontainers. Connector tests against recorded
responses. Front-end tests on the filter and detail flows. All green in CI.

**Done when:** the CI badge means something.

---

### M10 — Polish *(~5h)*

Screenshots, architecture diagram, the full ADR set including decisions worth revisiting,
`docs/cost.md`, verified clean-clone setup instructions, and a short recorded walkthrough.

**Done when:** the URL could be sent to a hiring manager with no explanation attached.

---

## Deliberately out of scope

- **No second city, and no second dataset.** One source — NYC DOHMH restaurant inspections — filtered
  to Staten Island, taken all the way through to a deployed, working map. Breadth is the cheap kind of
  impressive; a system finished end to end is the expensive kind. See M2 above for the full reasoning
  and for what that costs in claims this project can no longer make.
- **No LLM or OCR anywhere in the product.** Everything here is structured public data. AI tooling is
  used to *build* the project, and that is recorded in `docs/ai-engineering-log.md` — a separate
  thing from the product using AI.
- **No Cosmos DB.** Raw payload retention is a JSON column in SQL Server. A second database would be
  architecture chosen to look impressive rather than to solve a problem.
- **No microservices.** One API, one worker. The volume does not justify anything else and pretending
  otherwise would be a worse answer in an interview, not a better one.
