# Roadmap

Each milestone ends in something demonstrable. If work stops at M5, what exists is still a real
project rather than an abandoned scaffold — that ordering is deliberate.

Estimates are effort, not a schedule.

---

### M0 — Scaffold ✅ *(2026-07-25)*

Repo, solution layout, README written before any code, ADR-0001 and ADR-0002, `CLAUDE.md`, CI that
builds and tests both halves, branch protection on `main`.

**Done when:** a stranger can read the README and understand the goal; CI is green.

---

### M1 — Ingest one city *(~6h)*

NYC DOHMH connector. Canonical `Establishment` / `Inspection` / `Violation` model, EF Core
migrations, SQL Server running locally in Docker. Incremental fetch with a watermark, idempotent
upsert on `(SourceId, ExternalId)`.

**Done when:** the ingester runs twice over the same window and the row count does not change. That
assertion is a test, not a manual check.

---

### M2 — Ingest a second city *(~5h)*

Chicago connector. This is the milestone that proves ADR-0002 was right or wrong: a second source
with a different grading system, a different record grain, and different identity semantics. Grading
normalisation with per-source fixture tests.

**Done when:** both cities are queryable through one model, and the normalisation tests would fail if
a grading direction were inverted.

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

---

### M6 — Scoring and territories *(~5h)*

The opportunity score: inspection trend, critical-violation recency, licence age. Saved territories,
and a "what changed since you last looked" view.

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

- **No LLM or OCR anywhere in the product.** Everything here is structured public data. AI tooling is
  used to *build* the project, and that is recorded in `docs/ai-engineering-log.md` — a separate
  thing from the product using AI.
- **No Cosmos DB.** Raw payload retention is a JSON column in SQL Server. A second database would be
  architecture chosen to look impressive rather than to solve a problem.
- **No microservices.** One API, one worker. The volume does not justify anything else and pretending
  otherwise would be a worse answer in an interview, not a better one.
