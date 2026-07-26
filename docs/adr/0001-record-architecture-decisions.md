# ADR-0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

This project is being built partly to be explained. The decisions in it are more interesting than the code,
and they are the thing a reader — or an interviewer — will ask about. Six months from now I will not reliably
remember why the ingestion worker is a worker, or why establishments carry a `geography` column instead of two
`float` columns, and "it seemed right at the time" is not an answer I want to have to give.

A commit log records what changed. It does not record what was considered and discarded, which is where the
actual reasoning lives.

## Decision

Every architecturally significant decision gets a short markdown file in `docs/adr/`, numbered sequentially,
using the format below. A decision is architecturally significant if reversing it later would mean changing
more than one component, or if a reasonable engineer would ask "why did you do it that way."

Each ADR must contain, at minimum:

- **Context** — the forces in play, including constraints that are not technical (cost, time, what I did not
  yet know).
- **Decision** — what was chosen, in the active voice.
- **Alternatives considered** — what was rejected **and why it was rejected.** An ADR that lists only the
  chosen option is a description, not a decision record.
- **Consequences** — what this makes easy, what it makes hard, and what would force a revisit.

ADRs are immutable once accepted. If a decision changes, a new ADR supersedes the old one and both stay in the
repository. The record of having been wrong is part of the value.

## Alternatives considered

**Document decisions in the README.** Rejected: the README is read by someone deciding whether to care about
the project in the first thirty seconds, and decision rationale is the wrong content for that audience. It
would also grow without bound.

**Document decisions in code comments.** Rejected: comments explain the code that is there. They are a poor
home for the design that was rejected, because there is no file to put them in — the rejected design has no
code.

**Don't document decisions.** Rejected: this is the default, and it is why most of the systems I have worked
in cannot explain themselves. The cost is small and paid once; the benefit compounds every time someone new
reads the repository, including me.

## Consequences

- Adding an ADR is a small tax on every real decision, which will occasionally be skipped. Skipped ADRs are a
  known failure mode of this practice, not a surprise.
- ADRs are worth linking from the README, which is the only reason anyone will find them.
- Format is deliberately Michael Nygard's, unmodified — it is widely recognised, and a bespoke format would
  cost explanation for no benefit.
