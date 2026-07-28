# ADR-0007 — Reports assert conclusions, so rankings sort by what the data supports

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

M5b adds a reporting suite. The map answers "what is near here"; a report answers "which cuisines
have the worst results in Queens" — a question about aggregates, and one whose answer people will
read as a fact about the world.

That difference is the whole problem. **A map draws data. A report asserts a conclusion.** Every
existing rule in this repository about not inventing numbers has been about documentation — the
README, the milestone briefs, `docs/performance.md`. Reports move that rule into the product, where
it is enforced by code rather than by care.

The specific failure is a base-rate problem, and it is not hypothetical for this dataset. There are
89 cuisine values and five boroughs, and the cuisines are wildly unequal in size: "American" and
"Chinese" have thousands of establishments, while categories like "Californian" or "Chilean" have a
handful. Ranked by an observed percentage:

- A cuisine with **2 establishments and 1 poor result** shows **50%**.
- A cuisine with **400 establishments and 180 poor results** shows **45%**.

The first sorts above the second. A reader sees a clean table, sorted, with a percentage column, and
concludes something false about a cuisine — from correct data, correctly aggregated, correctly
rendered. Nothing fails. There is no error to notice.

This is the same shape as the failure `CLAUDE.md` names as the highest risk in the system: *"a sign
error here inverts the product's meaning while everything still runs."* A ranking that puts noise at
the top does exactly that to a report.

## Decision

### 1. Every group states its sample size, always, in the same table

`n` is a column, not a tooltip and not a footnote. A percentage without its denominator is not a
finding, and a reader cannot apply judgement to a number whose basis is hidden.

### 2. Rankings sort by the lower bound of a 95% Wilson score interval, not by the observed rate

Implemented as `ProportionEstimate.WilsonLowerBound` in `Freshline.Core.Reporting`.

Read it as **"the data supports a rate of at least this much"**. Two establishments with one poor
result observe 50% and support about 9%; four hundred with a hundred and eighty observe 45% and
support about 40%. Sorting on the supported floor puts the large group above the small one, which is
the answer somebody asking the question actually wants.

Small samples sink relative to one another, with no threshold to pick, defend or explain, and nothing
hidden from the reader. **They do not sink below large groups when the base rate is very low** — see
the measurement below, which corrects the stronger claim this paragraph originally made.

**Wilson rather than the textbook normal approximation** (`p̂ ± z·√(p̂(1−p̂)/n)`), which fails exactly
where it is needed: at small `n`, and at proportions near 0 or 1 where it produces bounds below zero
or above one. Wilson is well behaved at both, which is why it is the standard choice for ranking by a
rate.

**It lives in Core.** It is a scoring rule over two integers, and `CLAUDE.md` puts scoring rules in
Core — where it is a pure function, unit-testable with no database. The groups are small (five
boroughs, 89 cuisines), so computing it in memory after the aggregate returns costs nothing.

### 3. The displayed percentage is the observed one, unadjusted

The interval decides the **order of rows**. It never changes the number printed in one.

A report showing an adjusted percentage would be reporting something that did not happen, which is a
worse failure than the one this ADR exists to fix — it would be inventing a number in order to avoid
misrepresenting one.

### 4. Nothing derived from a truncated or filtered-away result is stated as a fact

Inherited from M5's `isTruncated` handling and extended: if a report cannot see the whole population
it is describing, it says so rather than describing the part it can see as though it were the whole.

## Alternatives considered

**A minimum sample threshold — exclude groups below some `n`.** Rejected on two counts. The number
would be arbitrary and would have to be defended in every conversation about the report, and it
*hides data*: a cuisine with four establishments and four closures is genuinely interesting, and
dropping it from the table is a different kind of lie.

**Revisit note:** this originally claimed the Wilson bound "ranks it appropriately without removing
it". The measurement below shows that is too strong at very small `n` against a very low base rate —
a group of two still tops the cuisine table. The rejection stands, on the arbitrariness and
hiding-data arguments alone, but not on the claim that the alternative is unnecessary.

**Show the sample size and let the reader judge.** Rejected as insufficient rather than wrong. It is
decision 1, and it is necessary — but a sortable percentage column is an invitation to sort by it,
and the person most likely to be misled is the one who did exactly what the interface suggested.

**Refuse to rank at all; show only counts.** Rejected because the question is legitimate and counts
answer a different one. "Which cuisine has the most poor results" is answered by counts and the
answer is always "the most common cuisine", which is nearly useless.

**Bayesian shrinkage towards the city-wide mean.** A defensible alternative that would produce
similar orderings. Rejected on explicability: it requires choosing and justifying a prior, and
`CLAUDE.md` requires that the author can narrate every non-obvious line. "The lower end of what the
data supports" is a sentence anyone can follow; "the posterior mean under a Beta(α, β) prior" is not,
and the improvement over Wilson here would be marginal.

**Compute the interval in SQL.** Rejected because it puts a domain rule in a query, where it cannot
be unit-tested without a database and cannot be reused by a second report without being copied.

## Measured against the real data, after implementing it

Run over all 23,528 establishments, grouped by cuisine (89 groups), ranked by share of establishments
whose latest outcome was `Poor`:

| Sorted by supported floor (shipped) | n | observed | supported |
|---|---|---|---|
| Basque | 2 | 50.00% | 9.45% |
| Creole | 16 | 6.25% | 1.11% |
| Hotdogs/Pretzels | 16 | 6.25% | 1.11% |
| Latin American | 795 | 1.51% | **0.87%** |
| Chinese | 1,736 | 1.09% | **0.70%** |
| Caribbean | 541 | 1.29% | **0.63%** |

| Sorted by observed rate (rejected) | n | observed | supported |
|---|---|---|---|
| Basque | 2 | 50.00% | 9.45% |
| Creole | 16 | 6.25% | 1.11% |
| Hotdogs/Pretzels | 16 | 6.25% | 1.11% |
| Pakistani | 31 | 3.23% | 0.57% |
| Soul Food | 46 | 2.17% | 0.38% |
| Bangladeshi | 61 | 1.64% | 0.29% |

**It works from row four onward.** The naive ordering fills the table with groups of 31, 46 and 61;
the shipped ordering replaces them with groups of 795, 1,736 and 541. Those are the rows somebody
reading this report should be looking at, and the naive sort buries them.

### Where it does not work, stated because it is measured

**A group of two still tops the table.** Basque, with one poor result out of two establishments,
observes 50% and supports 9.45% — and 9.45% is an order of magnitude above every large group, because
the city-wide `Poor` rate is around 0.5%. The interval demoted it from "50%, obviously first" to
"9.45%, still first", which is a smaller lie and not a true statement.

This is a **correction to the claim made when this ADR was written**, which said small samples sink
under their own uncertainty. They sink relative to each other; they do not sink below a large group
when the base rate is very low, because the uncertainty on a tiny sample is wide enough to remain
above a well-established small number.

Two consequences follow, and neither is optional:

- **`n` is not decoration, it is the load-bearing part.** Decision 1 was written as good practice and
  is in fact what makes the top of this table readable. A reader who sees `n=2` beside 50% knows what
  they are looking at.
- **The interface must not present the first row as "the worst cuisine".** It is a ranking, not a
  verdict, and the top of it can be noise that the ordering has merely made less loud.

A minimum-sample threshold *would* remove Basque from the table. It is still rejected — the number
would be arbitrary, and hiding a cuisine with two establishments and one closure is its own kind of
dishonesty — but the trade is closer than this ADR originally implied.

## Consequences

- **Ranked reports have two numeric columns with different jobs** — the observed rate, and the
  supported floor that determines the order. This needs explaining in the interface, and an
  unexplained second column would be worse than none.
- **The default sort of a ranking report is not the sort of its displayed percentage column.** A user
  who sorts by the percentage explicitly gets the naive order, because refusing to do what a column
  header says would be an interface lying about itself. The default is the defensible one; the
  override is theirs.
- **The interval assumes independent observations**, which inspections of the same establishment are
  not — an establishment inspected four times contributes four correlated results. The effect is that
  intervals are slightly narrower than they should be, i.e. slightly over-confident. Stated rather
  than corrected, because the correction is a clustered variance estimate and that trade lands the
  wrong side of the explicability rule for the size of the error.
- **95% is a convention, not a measurement.** Nothing about this dataset makes 95% the right
  confidence level; it is the one a reader is most likely to have seen before.
- **This does not make reports true.** It removes one specific way of being confidently wrong. A
  report over a filtered subset, or over a cuisine vocabulary the source assigns inconsistently, can
  still mislead — and the cuisine field is the source's own uncurated categorisation, which is a
  separate caveat that belongs beside any per-cuisine report.
