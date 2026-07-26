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
