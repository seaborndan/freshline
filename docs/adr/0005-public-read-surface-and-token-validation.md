# ADR-0005 — A public read surface, and an API that validates tokens without issuing them

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

M4 puts the data behind HTTP for the first time, which forces a question M1–M3 never had to answer:
who is allowed to read it, and how does the API know?

Three facts constrain the answer.

- **The data is public.** It is NYC's published inspection record, republished. Nothing here is
  confidential, and nothing about a caller reading it is sensitive.
- **The URL goes on a résumé at M5.** The milestone is finished when a stranger can open a live map
  and understand it. Anything between a hiring manager and a working map is a reason to close the
  tab.
- **M6 needs identity.** Saved territories and "what changed since you last looked" are per-user
  features. An auth surface retrofitted onto a live API is worse than one built alongside it.

The instinct is to put a login in front of the whole thing, because that is what an API with auth
usually looks like. Followed here it would defeat the product's main purpose to protect data that is
already public.

## Decision

### 1. The establishment list, detail and map endpoints are anonymous

No login, no signup, no token. Permanently, not until auth is ready.

The reason is a product one, not a technical one, and it is worth being blunt about: the value of this
API is that it can be opened and used. Authentication on a public dataset buys nothing and costs the
entire demonstration.

**The rule that does not bend:** if an endpoint triggers or controls ingestion, it is authenticated.
Reading published data is open; causing this system to act is not.

### 2. Anonymity is bounded by rate limiting, not by authentication

Open endpoints still need a limit on what one caller can consume. A token bucket per client IP
provides it — a burst for the normal case, a steady refill for the sustained one.

A token bucket rather than a fixed window because a fixed window permits twice the intended rate
across a boundary, and because bursts are the honest shape of map traffic: a user pans, firing several
requests in a second, then reads for a minute.

**One bucket across all the data endpoints, not one per endpoint.** What needs bounding is the load
one caller can put on the database, and separate buckets would let a caller spend several budgets at
once.

**Health checks and the OpenAPI document sit outside it.** A readiness probe is polled constantly from
a handful of addresses, which is exactly the traffic a per-IP limiter reads as abuse; throttling it
returns a 429 the load balancer interprets as an unhealthy instance, and the limiter becomes the
outage it was meant to prevent.

### 3. The API validates tokens and does not issue them

There is no login endpoint, no token endpoint, no user store and no password handling anywhere in
this service. Issuance is a separate concern with its own storage, rotation and revocation story.

M4 builds the validating half so M6 has something to hang identity on. Tests mint tokens with a test
key, which is what a separate issuer will do in production.

### 4. The signing key is asymmetric

This is what makes decision 3 a fact rather than a promise.

With a shared symmetric secret, the power to verify a signature *is* the power to forge one. Every
service holding the key is an issuer whether it intends to be or not, and "this API does not issue
tokens" becomes a statement about restraint. With RSA the API holds only the public half: it can check
a signature and cannot produce one.

A useful consequence rather than the motivation: a public key is not a secret. **The API's
authentication configuration contains nothing confidential** — no Key Vault entry to provision, and
nothing that could leak.

### 5. CORS is a configured origin list, and credentials are never allowed

There is a real argument for `AllowAnyOrigin` on an anonymous public API — CORS protects a user's
credentials rather than the data, and with no cookies there is nothing to protect. It is rejected
because decision 3 puts an `Authorization` header on this API, and a permissive list is one
`AllowCredentials()` away from letting any site make authenticated calls with a visitor's session.

**Credentials stay disallowed permanently**, including after an issuer exists. Bearer tokens are
attached explicitly by JavaScript and cross origins without it; enabling it would only add automatic
cookie sending, which is the mechanism cross-site request forgery runs on, for a capability this API
does not use.

## Alternatives considered

**Authenticate everything, with a demo account in the README.** Rejected. It converts a working map
into a set of instructions, and a stranger evaluating the project in ninety seconds does not follow
instructions.

**Authenticate everything, and open it later.** Rejected on ordering. Opening a closed API is easy;
this milestone's deliverable is the open one, and deferring it defers the thing being built toward.

**Build no auth at M4 and add it at M6.** Rejected in the brief and worth restating: an auth surface
added to an API that is already deployed and consumed is a breaking change negotiated with clients.
Built now, it is a file nobody is using yet.

**Issue tokens here too.** Rejected as scope. It is a user store, password hashing, reset flows,
rotation and revocation — a milestone of its own, none of which M4 needs to be able to *check* a
token.

**A symmetric signing key, for simplicity.** Rejected as described in decision 4. It is simpler by
one configuration value and contradicts the split it is meant to implement.

**Rate limit by authenticated user rather than by IP.** Rejected because it cannot work here: the
endpoints that need limiting are the anonymous ones. There is no user to limit by, which is the
condition the design has to hold under.

## Consequences

- **The rate limiter partitions on `RemoteIpAddress`, and that is wrong behind a proxy.** Any reverse
  proxy, CDN or cloud ingress collapses every caller into one bucket and turns a per-client limit into
  a global one that locks everybody out together. The fix is `UseForwardedHeaders` with `KnownProxies`
  or `KnownNetworks` populated with that proxy's actual addresses — and only that way, because
  `X-Forwarded-For` is caller-supplied and trusting it unconditionally lets an attacker mint a fresh
  bucket per request. Those addresses are a property of a deployment that does not exist yet.
  **This is a deploy-time blocker for M5**, not a cleanup.
- **The limiter is per-instance**, held in one process's memory. Two instances behind a load balancer
  permit twice the configured rate.
- **The limits are chosen, not measured.** No load test has been run against deployed hardware. They
  bound one caller; they are not a capacity claim, and no number from them appears in
  `docs/performance.md`.
- **Nothing issues tokens**, so the auth surface has no production user until M6.
- **There is no revocation, and stateless bearer tokens cannot have any.** A token is valid until it
  expires because nothing is consulted while it is. Short lifetimes are the whole mitigation and they
  are an issuer's setting. Anything wanting "sign out everywhere" needs a different design rather than
  an addition to this one.
- **Key rotation is a coordinated restart**, because a single public key is configured directly. A
  JWKS endpoint keyed by `kid` is the standard answer and is M6 work.
- **The public endpoints must be defended against drift.** A global authorization fallback policy is
  the natural thing to reach for once auth exists, and it would silently close the map. There is a
  test per endpoint asserting it answers without a token, and tests asserting the OpenAPI document
  does not claim otherwise.
