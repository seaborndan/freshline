# Public records request — TDH food service establishment inspections

> **Status: drafted, not sent. Not part of the current scope.**
>
> Tennessee and Hawaii were both investigated as data sources during M1 and both were rejected:
> they publish restaurant inspections only through a third-party vendor portal whose `robots.txt`
> disallows all automated access, naming AI crawlers and "content aggregators" explicitly. Nashville's
> own open-data portal has migrated off Socrata to ArcGIS Hub and holds no inspection data; Franklin's
> Socrata portal holds only aggregate building-permit statistics.
>
> This letter is the legitimate route to that data, kept because drafting it again from scratch would
> be wasteful and because "I asked properly instead of scraping a site that forbids it" is the part of
> the story worth being able to point at. The project is deliberately scoped to one source
> ([roadmap](../roadmap.md#m2--ingest-a-second-city--cut)), so nothing depends on this being sent.

**Send to:** Tennessee Department of Health, Office of Open Records Counsel liaison /
Environmental Health Program. TDH's public records request page lists the current Public Records
Request Coordinator and the required form — use that form if one is mandated; the text below is
written to drop into it.

**Legal basis:** Tennessee Public Records Act, T.C.A. § 10-7-503.
**Note before sending:** the TPRA is available to *citizens of Tennessee*, and the custodian may
require proof of Tennessee citizenship (a driver's licence is normally accepted). Requests may be
made in person, by mail, fax, or email, and the custodian has 7 business days to respond, produce,
or state a reason for denial.

---

Subject: Public records request — food service establishment inspection data (electronic format)

To the Public Records Request Coordinator,

Under the Tennessee Public Records Act, T.C.A. § 10-7-503, I am requesting access to and a copy of
records held by the Department's Environmental Health Program concerning inspections of permitted
food service establishments.

**Records requested**

An electronic extract of food service establishment inspection records for the period 1 January 2023
to the present, containing for each inspection:

- the establishment's permit or facility identifier
- establishment name and physical address (including county and ZIP)
- inspection date
- inspection type or purpose (routine, follow-up, complaint, etc.)
- the numeric inspection score
- each violation recorded, with its item number/code and description, and whether it was classified
  as priority or non-priority

Together with, if held separately, the current list of permitted food service establishments and
their permit status.

**Format**

I am requesting these records in the electronic format in which they are ordinarily maintained —
CSV, TSV, Excel, or a database export are all acceptable, in decreasing order of preference. I am
not requesting scanned or printed inspection reports, and I am not requesting that any new record be
created, compiled, or formatted specially. If the data is held by a third-party vendor under
contract to the Department, I am requesting the Department's copy of, or its contractual right of
access to, that data.

**Narrowing**

If the request as scoped would be unduly burdensome or would incur significant cost, I am glad to
narrow it, and I would welcome a conversation about which of the following reductions is most
helpful to you:

- a shorter date range (for example, the most recent 12 months)
- a single county (Davidson or Williamson would both suit me)
- inspection-level records only, omitting the per-violation detail

**Fees**

Please advise in advance of any fees. Under the Office of Open Records Counsel's schedule I
understand labour charges may apply beyond the first hour. I am willing to pay reasonable
duplication costs; please contact me before incurring charges above $25 so I can confirm or narrow
the request.

**Purpose**

For transparency, this is not a commercial data-broker request. I am a software engineer building a
non-commercial portfolio application that normalises publicly available health-inspection data and
presents it on a map. Attribution to the Department will be displayed. I
am asking for bulk access because the Department's public inspection portal is operated by a vendor
whose terms do not permit automated retrieval, and I would rather obtain the data through a proper
channel than work around that.

I would be grateful for any guidance if another division, or the Tennessee Department of
Agriculture's retail food programme, is the correct custodian for part of this request.

Thank you for your time.

[Name]
[Address — a Tennessee address, since the TPRA is limited to Tennessee citizens]
[Email]
[Phone]

---

## Hawaii equivalent, if wanted

Hawaii's Uniform Information Practices Act (HRS Chapter 92F) is **not** limited to state residents,
so the same request can go to the Hawaii Department of Health Food Safety Branch without a residency
problem. Requests go through the State of Hawaii's UIPA Record Request System. The substance of the
letter above transfers directly; the placard colour (green / yellow / red) replaces the numeric
score as the headline field, and Hawaii would need its own normalisation either way.
