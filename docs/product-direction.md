# Product direction — 5 September 2026

Freshline now connects discovery, dated evidence, saved territories and the next action. It is
ready for a small user pilot. It has not yet established that suppliers will return regularly or
pay for it. Automated tests and local workflow checks validate behavior, not market demand.

## The working hypothesis

Help an independent supplier or field rep prepare for useful conversations with nearby restaurants.
The strongest workflow is: choose a territory, understand a restaurant, save a shortlist, record
context, and return when follow-up is due. Inspection citations are one discovery lens. They do
not prove buying intent, a current unresolved problem, or a need for a particular product.

The four evidence categories support pest control, sanitation, temperature control and plumbing /
handwashing research. Broad food, packaging and beverage suppliers can use the general explorer
and history, but the current data cannot honestly rank their purchasing needs. Product language
should acknowledge that limit rather than disguise a pest-control product as universal intelligence.

## Ideas evaluated and implemented

| Idea | Why it helps | Verification / limit |
| --- | --- | --- |
| Follow-up dates and due view | Makes a saved list useful on a second visit | Local calendar dates, overdue inclusion and excluded Not a fit records tested; no notifications |
| Search notes and stage; rename lists | Supports working a territory after initial discovery | Filtering and collision protection tested; local browser storage |
| Backup with restore preview | Gives users a recovery path outside browser storage | Version validation and existing-record preservation tested; backup remains a user-managed file |
| Check for newer inspection | Exposes stale saved evidence before a conversation | Newer, repeated and unavailable evidence tested; never silently rewrites the snapshot |
| Bookmark discovery filters | Makes a territory repeatable | Submitted filters round-trip through URL; list links still require local saved data |
| Page long result sets | Keeps cards manageable | Twenty cards per page over loaded results; does not bypass the API's 200-result limit |
| Load map code on map routes | Reduces cost of opening discovery or saved work | Production entry measured at 260.18 kB; map code still costs 949.46 kB when opened |

## Promising next experiments

1. **Territory briefing:** a compact preparation sheet with restaurants, cited evidence and user
   notes. Validate whether reps actually carry or export it before building a complex report designer.
2. **Visit planning:** select today's stops and open directions. First test whether people want
   geographic grouping or optimized driving order; these are different needs.
3. **Changes since last visit:** a digest of newly ingested inspections for saved restaurants.
   Useful only with a dependable ingestion cadence and explicit distinction between observation
   dates and ingestion dates. The manual evidence check is the first experiment.
4. **New-business discovery:** potentially valuable across supplier categories, but requires
   verified licence / opening signals. A missing inspection is not proof of a new opening.
5. **Conversation preparation:** evidence plus user-authored questions. Any generated wording must
   cite its source and avoid accusing a restaurant or asserting an unresolved condition.

Do not add an opaque lead score, fabricated contact data, automated outreach or a paid enrichment
service merely to make the interface look more complete. Those features need evidence of demand
and a reliable source / operating model.

## Decisions parked for the owner

- First pilot audience: an independent field rep, a small supplier team, or a service contractor?
- Hosting and data-refresh cadence: what freshness can the product actually promise?
- Shared accounts and cloud lists: team value versus operating cost and privacy obligations.
- External routing or contact enrichment: provider, cost, data rights and acceptable limitations.
- Additional cities / licence feeds: source quality and comparability before expansion.

Authentication, schema changes and new dependencies require human review under `CLAUDE.md`.
None were needed for this pass. These decisions do not block testing the present workflow.

## Pilot before the next large build

Have a prospective user bring a real territory and explain how they choose restaurants today.
Observe them build a shortlist, explain the evidence in their own words, make notes, and return
to it later. Record confusing categories, missing information, mistaken inferences and whether
the saved workflow replaces a real task. Ask what they would stop using if they adopted Freshline.
Use those observations to choose the next experiment; clicks alone do not establish value.
