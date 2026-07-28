# ADR-0006 — Trusting the ingress, not the caller: the client address behind a proxy

- **Status:** Accepted
- **Date:** 2026-07-27
- **Supersedes:** the first consequence of
  [ADR-0005](0005-public-read-surface-and-token-validation.md), which prescribed `KnownProxies` or
  `KnownNetworks` "and only that way". That instruction cannot be followed on the platform M5
  deploys to. The rest of ADR-0005 stands.

## Context

ADR-0005 chose anonymous read endpoints bounded by a token bucket per client IP. That design has one
dependency it could not satisfy at the time: **the API has to know who the client is**, and it learns
that from `HttpContext.Connection.RemoteIpAddress`.

That value is correct exactly when the client connects to the process directly. It is wrong the
moment anything sits in front of it, which is every deployment. Behind an ingress, `RemoteIpAddress`
is the *ingress's* address, identically for every visitor.

The failure that produces is worse than no limiter at all. Every caller lands in one bucket, so the
first visitor to exhaust it locks out everyone else. A mechanism whose purpose is to stop one caller
degrading the service for others becomes the thing that degrades the service for others — and it does
so under normal traffic, not under attack.

The standard fix is to read `X-Forwarded-For`. The difficulty is that this header is written by
whoever sends the request. Believing it without qualification is strictly worse than ignoring it: a
caller can then put a new value in it on every request and never be rate limited at all, which
switches the limiter off for precisely the caller it exists to stop. So there are two opposite ways to
get this wrong, and the design has to land between them.

ADR-0005 assumed the answer would be `KnownProxies` — tell the middleware the proxy's real addresses
and have it trust the header only on connections from those addresses. That is the correct answer in
general, and it was written down before a deployment target existed.

**A deployment target now exists, and it makes that answer unavailable.** M5 deploys the API to Azure
Container Apps. On the consumption profile the ingress addresses are managed by the platform, are not
published, and change without notice. Any list written into configuration would be a list of guesses
that stops matching reality at a time nobody chooses, and the symptom would be the *first* failure
above — everyone sharing a bucket — arriving in production for a reason nothing in the repository
explains.

## Decision

### 1. Trust is bounded by `ForwardLimit`, and `KnownProxies` is left empty

`X-Forwarded-For` is a list, and each proxy **appends** to it rather than replacing it. ASP.NET Core's
middleware reads that list right to left and `ForwardLimit` caps how many entries it will walk.

With `ForwardLimit` set to the number of proxies actually in front of the process, only the entries
those proxies wrote are ever read. A caller who sends `X-Forwarded-For: 1.2.3.4` produces
`1.2.3.4, their-real-address` by the time it arrives, because the ingress appended what it observed.
Reading one entry from the right yields the real address. The forged value is present in the request
and is never reached.

`KnownProxies` and `KnownIPNetworks` are cleared rather than left at their defaults, so the middleware
does not additionally require the connection to originate from a listed address.

### 2. The hop count is configuration, and it defaults to zero

`Ingress:ProxyHopCount`, bound in `Freshline.Api.Hosting.IngressConfiguration`. Zero means no proxy,
and **at zero the middleware is not registered at all** — not registered with a limit of zero.

The distinction matters. Locally there is no proxy, so a process that read the header would let any
caller mint a fresh bucket per request. Omitting the middleware entirely means no configuration
mistake can switch that on by accident, and the header is not read under any circumstances on a
developer's machine.

A deployment that genuinely has a proxy states so explicitly. It is `1` on Container Apps, which puts
one Envoy ingress in front of the container and nothing else.

### 3. `X-Forwarded-Proto` is honoured along with `X-Forwarded-For`

The ingress terminates TLS, so without it every request looks like plain HTTP to this process and
`UseHttpsRedirection` redirects a request that already arrived over HTTPS. That is a redirect loop
rather than an inconvenience, and it would take the whole API down while every component reported
itself healthy.

### 4. The property is tested through the rate limiter, not through a new endpoint

There is no way to ask this API what address it decided a caller has, and adding one would mean adding
an endpoint whose only purpose is to report the API's internal state. So the question is asked through
the component whose entire behaviour turns on the answer: *did these two requests share a bucket?*

Three tests, against a host configured with a two-request bucket that does not refill: two callers
behind the proxy get separate buckets; a forged leading entry that changes on every request does not
buy a fresh one; and with no proxy declared the header is ignored entirely.

## Alternatives considered

**`KnownProxies` with the ingress addresses, as ADR-0005 prescribed.** Rejected because the addresses
cannot be known on this platform — not "are inconvenient to obtain". They are platform-managed,
undocumented, and change without notice. A configuration value that must match something unknowable
is a scheduled outage.

**A topology with a stable, knowable ingress address**, which would make `KnownProxies` viable again.
Rejected for M5 on scope rather than on merit: it means provisioning infrastructure beyond a container
and a database to satisfy a configuration preference, in a milestone whose deployment the roadmap
deliberately keeps manual.

Stated as a direction rather than as a plan, because **it has not been verified that any Container
Apps configuration actually offers this** — the paid tiers were not investigated, and no claim is made
here about what they do or do not provide. Establishing that is M7 work, when infrastructure is
described in Bicep and the question has to be answered anyway. **This is the alternative to revisit if
the residual risk below ever stops being acceptable.**

**Partition the limiter on something other than the address** — an API key, or a session cookie.
Rejected because it contradicts ADR-0005 directly. The endpoints needing limits are the anonymous
ones; there is nothing to partition by that a caller cannot also mint at will. That is the same
problem one layer up.

**Ignore `X-Forwarded-For` and accept one shared bucket.** Rejected: it makes the limiter an
availability risk under normal traffic, which is worse than the abuse it was added to prevent. The
limits in ADR-0005 were sized for one caller, not for all of them added together.

**Remove the rate limiter for M5 and restore it when the platform allows `KnownProxies`.** Rejected
because the endpoints are anonymous and public, and an unlimited anonymous endpoint on a database this
size is the thing the limiter exists for. Shipping without it to avoid a configuration difficulty is
the wrong trade.

## Consequences

- **The remaining assumption is about network topology, not about caller behaviour.** Clearing
  `KnownProxies` removes the check that a connection came from a trusted address, so what holds this
  up is that nothing can reach the container except through the ingress. On Container Apps with
  external ingress that is true — the container's port is not routable from the internet. An
  assumption about the shape of the network is the better of the two to be left with, because it does
  not depend on anyone being honest.
- **Microsoft's own documentation calls `ForwardLimit` "a precaution, but not a guarantee".** That
  sentence is quoted rather than paraphrased because it is the accurate description of what this buys.
- **`ProxyHopCount` must change if the topology does.** Adding a CDN or a WAF in front of the ingress
  adds a hop, and leaving the number at `1` would then read an entry the new proxy wrote rather than
  the ingress's — or, if set too high, walk into the part a caller controls. **This is the single
  value that must be revisited on any change to what sits in front of the API**, and it is the reason
  the setting is named after the topology rather than after the header.
- **No test in this repository can confirm the number is right.** The tests prove the middleware
  behaves correctly at a given hop count; only a request with a forged header against the real
  deployed ingress proves the hop count matches the deployment. That check is written into
  [`docs/deployment.md`](../deployment.md) as a required post-deploy step **and has not been run**,
  because nothing has been deployed yet.
- **This is per-instance, like the limiter it serves.** ADR-0005's consequence stands unchanged: two
  instances behind a load balancer permit twice the configured rate, and reading the correct client
  address does not alter that.
- **M7 revisits this with the rest of the infrastructure.** If Bicep provisions a topology with a
  stable ingress address, `KnownProxies` becomes available and this ADR should be superseded rather
  than quietly amended.
