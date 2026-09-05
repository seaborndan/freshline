# CLAUDE.md — working conventions for this repository

Instructions for AI assistants working in this repo, and a statement of the conventions a human
contributor should follow too. If a change conflicts with something here, raise it rather than
quietly working around it.

## What this project is

For the latest cross-agent development handoff, read `docs/handoff.md` before starting work.

Freshline aggregates public health-inspection and business-licence data from city open-data portals,
normalises it into one schema, scores establishments, and serves the result to a map UI. See
`README.md` for the product framing and `docs/adr/` for decisions.

It is also a portfolio project, which imposes one unusual requirement: **the author must be able to
explain every non-obvious line in it.** Code that works but cannot be narrated has failed its purpose
here. Prefer the explainable implementation over the clever one, and when there is a genuine
trade-off, write an ADR instead of a comment.

## Architecture rules

The dependency direction is one-way and is not negotiable:

```
Api ─────┐
         ├──► Infrastructure ──► Core
Ingestion┘
```

- **`Freshline.Core`** — domain model, scoring rules, and the interfaces the outer layers implement.
  Has **no** dependency on EF Core, ASP.NET, HTTP clients, or any Azure SDK. If something in Core
  needs a package reference to compile, it probably belongs in Infrastructure.
- **`Freshline.Infrastructure`** — EF Core `DbContext`, configurations, migrations, Socrata clients,
  and the per-source connectors. Implements interfaces defined in Core.
- **`Freshline.Api`** — HTTP only. Controllers/endpoints, auth, serialisation, validation, error
  shaping. Business rules do not live here.
- **`Freshline.Ingestion`** — the scheduled worker. Orchestration only; the actual fetching and
  mapping lives in Infrastructure so it can be tested without a host.

Cross-layer shortcuts ("just this once, the API will query the DbContext directly") are the specific
thing this layout exists to prevent.

## Data and correctness rules

- **Ingestion must be idempotent.** Re-running any window must update rather than duplicate. Identity
  is `(SourceId, ExternalId)` — see ADR-0002.
- **Grading normalisation is the highest-risk code in the system.** Different cities grade in
  opposite directions. Every source's normalisation gets unit tests with fixtures captured from real
  responses. A sign error here inverts the product's meaning while everything still runs.
- **Raw source payloads are retained and immutable.** A mapping bug should be fixable by
  re-normalising stored data, not by re-fetching from every city.
- **Never invent a number.** No placeholder metrics, no illustrative figures in the README, no
  "approximately" in a results table. If it has not been measured, the section stays empty.

## Testing expectations

- xUnit for .NET, Vitest + React Testing Library for the front end. Both run in CI on every PR.
- Normalisation, scoring, and idempotency logic get direct unit tests. These are the parts where a
  silent wrong answer is possible.
- Front-end tests query by role and visible text, not by test id or class name.
- Coverage is a diagnostic, never a target. Do not add tests to move a percentage.
- A test that would pass against a wrong implementation is worse than no test.

## Security rules

- **No secrets in the repository, ever** — not in `appsettings.json`, not in compose files beyond the
  throwaway local SQL password, not in CI YAML. Azure secrets come from Key Vault via managed
  identity. Deploys authenticate with OIDC federated credentials, not a stored service-principal
  secret.
- NuGet vulnerability advisories (NU1901–NU1904) are promoted to build errors in
  `Directory.Build.props`. Do not downgrade them to warnings to get a build green — patch the
  package or pin a fixed version with a comment saying why.

## Guardrails on AI-assisted work

What AI tooling is **not** allowed to do here without line-by-line human review:

- Database schema and EF Core migrations.
- Authentication and authorisation logic.
- Anything touching the grading-normalisation direction.
- Dependency additions. A new package is a decision, not an implementation detail.

The verification loop for anything AI-generated: read it, then prove it — a test, a query plan, a
run against real data, or a documented manual check. "It compiles and looks right" is not
verification. Where the author accepted something without fully verifying it, that gets recorded
honestly in `docs/ai-engineering-log.md`.

## Conventions

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`. Never
  `fixed stuff`.
- `main` is protected. Changes arrive by PR with CI green.
- File-scoped namespaces, `var` only when the type is apparent — enforced by `.editorconfig`.
- Nullable reference types are enabled everywhere. Do not suppress with `!` to silence a warning;
  handle the null or explain in a comment why it cannot occur.
- Public API responses use `ProblemDetails` for failures and correct status codes.
