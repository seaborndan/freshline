# API fixtures

Captured from the running API on 2026-07-26, not written by hand from the C# records. The point of a
fixture is to be evidence of what the service actually sends; one transcribed from the type it is
supposed to send proves only that two files agree.

| File | Captured from |
|---|---|
| `map-viewport.json` | `GET /establishments/map` — assembled, see below |
| `establishment-detail.json` | `GET /establishments/21` verbatim |
| `problem-400.json` | `GET /establishments/map?minLat=40.7&maxLat=40.8&minLon=-74.0` — three of four bounds |
| `problem-429.json` | the 72nd request in a burst, verbatim |

`map-viewport.json` is the one assembly: every pin in it is a real row from a real response, but no
single viewport contains all six states worth testing, so they are collected into one `items` array.
The alternative was six fixtures differing in one field each.

Two things in here that a hand-written fixture would have got wrong, and which the parser is built
around:

- **The 429 body has no `type` member**, while the 400 does. A parser that requires `type` handles
  every error the API produces except the one that happens under load.
- **`Ungraded` can carry a `normalisedSeverity` and a null `rawGrade` at the same time** — see
  `POPEYES`, closed by the authority at 75 with no letter grade published. "No grade" and "no data"
  are different facts and this row is the proof.
