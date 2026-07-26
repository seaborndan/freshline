# NYC DOHMH fixtures

Response bodies captured **verbatim** from the live API on 2026-07-25 and committed unedited. They
are the test data precisely because nobody wrote them: a hand-authored fixture encodes what its
author believed the API returns, which is the assumption these tests exist to check. ADR-0002 was
written from that kind of belief and was partly wrong.

Each file is the raw body of one request. Re-run the URL to see whether the source has changed
underneath the tests — if a fixture and a fresh response now disagree, that is a finding, not a
maintenance chore.

Base resource: `https://data.cityofnewyork.us/resource/43nn-pn8j.json`

| File | Rows | What it pins down | `$where` |
|---|---|---|---|
| `graded-a-with-violations.json` | 6 | One half of the grading-direction assertion. Scores 6 and 12. | `boro='Staten Island' AND grade='A' AND violation_code IS NOT NULL AND inspection_date > '2026-01-01T00:00:00'` |
| `graded-c.json` | 6 | The other half — score 39 — and the per-violation grain: six rows, one establishment, one inspection. | `boro='Staten Island' AND grade='C'` |
| `grade-n-z-p.json` | 9 | The three grade values ADR-0002 did not know existed. | `grade in('N','Z','P') AND boro='Staten Island'` |
| `no-violations-recorded.json` | 4 | An inspection that cited nothing still has to produce an inspection. | `boro='Staten Island' AND action like 'No violations%'` |
| `never-inspected-sentinel.json` | 4 | The 1900-01-01 sentinel: permitted, never inspected. The newly-licensed signal. | `inspection_date='1900-01-01T00:00:00'` |
| `closed-by-dohmh.json` | 4 | Closure detection, and the reason it is a prefix match rather than a search for "closed". | `boro='Staten Island' AND action like 'Establishment Closed%'` |
| `duplicate-rows.json` | 2 | Two byte-identical rows the source publishes twice. One of 140 such groups city-wide. | `camis='50166415' AND inspection_date='2026-02-09T00:00:00' AND violation_code='08A'` |

Ordering, where it mattered for reproducibility, was `$order=inspection_date DESC`.
