# Deployment

Deploying Freshline by hand, which is what M5 calls for. **M7 replaces all of this with Bicep and
deploy-on-merge** — see `docs/roadmap.md`. Nothing here is meant to survive that milestone; it is
meant to get a working URL and to record what the deploy actually needs, so the Bicep that replaces
it is written from something true rather than from memory.

Two pieces go out:

| Piece | What it is | Where it goes |
|---|---|---|
| `Freshline.Api` | A container image, built from the root `Dockerfile` | Azure Container Apps |
| `web/` | Static files from `npm run build` | Azure Static Web Apps |

The ingestion worker is **not** deployed here. It is a scheduled job, not part of the request path,
and the database it fills can be filled by running it from a workstation.

## The ordering problem, which is the only awkward part

Each half needs the other's URL before it can be configured:

- the web build bakes the API's origin in at build time (`VITE_API_BASE_URL`);
- the API's CORS policy has to name the web app's exact origin, or the browser refuses every
  response.

Neither URL exists until its half is deployed. So the order is fixed, and the last step is not
optional:

1. **Deploy the API.** CORS is empty at this point, which is fine — nothing is calling it from a
   browser yet.
2. **Note the API's URL**, then build and deploy the web app with it.
3. **Note the web app's URL**, then go back and set `Cors__AllowedOrigins__0` on the API.

Skip step 3 and the site loads, the map draws, and every data request fails in the browser console
with a CORS error while the API itself reports 200s. That failure looks like a front-end bug and is
not one.

## The API

### Build the image

```bash
docker build -t freshline-api .
```

The build context is the repository root, not `src/Freshline.Api` — the project references Core and
Infrastructure, and `Directory.Build.props` at the root is what makes NuGet advisories build errors.
Reasoning is in the `Dockerfile` itself.

The container listens on **8080** and runs as a non-root user, so the ingress must target 8080.

### Configuration it needs

Set as environment variables. The double underscore is how .NET maps a flat variable onto a nested
configuration key.

| Variable | Value | Why |
|---|---|---|
| `ConnectionStrings__Freshline` | the Azure SQL connection string | **From Key Vault via managed identity, never a literal.** See `CLAUDE.md`. |
| `Ingress__ProxyHopCount` | `1` | One Envoy ingress in front of the container. **See below — this one is easy to get wrong in both directions.** |
| `Cors__AllowedOrigins__0` | the web app's exact origin | Scheme and host, no trailing slash: `https://example.azurestaticapps.net` |
| `ASPNETCORE_ENVIRONMENT` | `Production` | The default, stated because the CORS development fallback keys off it. |

### `Ingress__ProxyHopCount` is the setting to get right

The rate limiter partitions on the caller's address. Behind an ingress that address is the *proxy's*
unless `X-Forwarded-For` is read, and that header is caller-supplied, so reading it carelessly is
worse than not reading it. `src/Freshline.Api/Hosting/IngressConfiguration.cs` explains the whole
design; the two failure modes are:

- **Set it to 0 (or leave it unset) behind the ingress.** Every visitor shares one rate-limit bucket.
  The first one to spend it locks out everybody, and the limiter becomes the outage it exists to
  prevent. `UseHttpsRedirection` also starts redirecting requests that already arrived over TLS,
  which is a loop rather than an inconvenience.
- **Set it higher than the real number of proxies.** The middleware walks further left along
  `X-Forwarded-For` than any real proxy wrote, into the part a caller controls — so anyone can mint a
  fresh bucket per request and the limiter stops applying to precisely the caller it exists to stop.

It is `1` on Container Apps because Container Apps puts one Envoy ingress in front of the container
and nothing else. **If the topology ever gains a CDN or a WAF, this number changes with it.**

### Verify the deploy, rather than assume it

Three checks, in order. The third is the one that cannot be done anywhere but against the real
deployment, and it is the reason the rest of this section exists.

```bash
API=https://<the-api-url>

# 1. The process is up. Runs no checks by design, so this stays 200 even with the database down.
curl -s -o /dev/null -w '%{http_code}\n' $API/health              # expect 200

# 2. The database is reachable from the container. 503 here means managed identity or the
#    connection string, not the image.
curl -s -o /dev/null -w '%{http_code}\n' $API/health/ready        # expect 200

# 3. A forged X-Forwarded-For does not buy a fresh rate-limit bucket.
#    Send more requests than the burst size with a different forged address each time.
#    A 429 appearing means the forged value was ignored and the real address was counted — correct.
#    All 200s means ForwardLimit is too high and the limiter can be switched off by anyone.
for i in $(seq 1 70); do
  curl -s -o /dev/null -w '%{http_code} ' -H "X-Forwarded-For: 10.0.0.$i" \
    "$API/api/v1/establishments/1"
done; echo
```

Check 3 has an integration test behind it (`ForwardedHeadersTests`), and the test proves the
*middleware* behaves correctly. Only this check proves the **hop count matches the real topology**,
which is the part no test in the repository can know.

## If the database is Azure SQL serverless, the health probe is a trap

Worth reading before configuring the container app, because the failure is silent, takes about two
days, and looks like nothing at all until the database stops answering.

Azure SQL's free offer is a **serverless** database: it auto-pauses when idle, and the free grant is
100,000 vCore-seconds per month. While online it bills at least
`max(minimum vCores, minimum memory GB ÷ 3)` every second — **0.7 vCore-seconds per second** at the
0.5-vCore minimum — so the grant is worth roughly **40 hours of being awake per month**, not 40 hours
of queries.

Auto-pause requires zero sessions *and* zero user CPU for the whole delay window. A login is an
auto-resume trigger.

**`/health/ready` queries the database.** Point a Container Apps readiness probe at it and the
database is logged into every few seconds forever: it never pauses, spends the grant in under two
days, and then either pauses until the first of next month or starts billing, depending on the
behaviour chosen at creation.

So, on a serverless database:

- **Liveness probe → `/health`.** It runs no checks and touches nothing.
- **Readiness probe → `/health` as well, or leave it unset.** Not `/health/ready`.

That is a real loss and it should be recorded as one. `/health/ready` exists to tell a load balancer
that an instance cannot serve traffic, and it is the right endpoint on any always-on database. On a
database that sleeps on purpose, "paused" and "unreachable" are indistinguishable to a prober, and
probing to find out is what stops it sleeping. The endpoint stays in the API and stays useful — from
a person's terminal, from a deploy script, from a monitor that runs a few times a day — it just
cannot be the thing a platform polls continuously.

Recommended settings when creating the database:

| Setting | Value | Why |
|---|---|---|
| Auto-pause delay | **15 minutes** (the minimum) | The default of 60 spends ~2,520 vCore-seconds on a single visit, which is about 39 isolated visits a month. At 15 minutes it is ~630, or about 158. |
| Minimum vCores | 0.5 | The floor for billing while awake. |
| Behaviour at free limit | **Auto-pause until next month** | The other option keeps it online and bills you. This one cannot produce a surprise. |

Even so, **the first visitor after a pause pays for the resume.** Microsoft documents the first
connection as *failing* with error 40613 while it starts the resume, with the client expected to
retry, and resume latency as "on the order of one minute". `AddFreshlinePersistence` enables EF
Core's retry-on-failure so that failure is absorbed rather than returned — but absorbed is not
instant, and a cold visitor waits.

**This has not been measured.** It is read from documentation, and the number that matters — what a
real first visit costs in seconds — can only come from the deployed thing.

## The web app

```bash
cd web
VITE_API_BASE_URL=https://<the-api-url> npm run build
```

`VITE_API_BASE_URL` is **required** for a production build and `vite.config.ts` fails the build
without it. That is deliberate: `client.ts` falls back to `http://localhost:5045` in development, and
a bundle built without the variable would ship a live site that asks *the visitor's own machine* for
its data — failing on every request, and looking exactly like the API being down.

The output is `web/dist/`. It is static files with no server-side rendering and no Node runtime.

Confirm the value actually landed in the bundle before uploading it:

```bash
grep -c '<the-api-url>' dist/assets/*.js     # expect 1 or more
grep -c 'localhost:5045' dist/assets/*.js    # expect 0
```

The second is not paranoia. It is the check that the development fallback was compiled out rather
than merely unused.

### Basemap tiles come from CARTO, not from this deployment

The map fetches its tiles from `basemaps.cartocdn.com` at runtime. Nothing needs configuring, and
there is no key — but it does mean the deployed site depends on a third party being up, and CARTO's
attribution is required to stay visible. See `web/src/map/initialView.ts`.

## What is deliberately not here

- **Bicep, ARM, or any IaC.** M7.
- **A deploy job in `.github/workflows/`.** Also M7, along with the OIDC federated credential it
  needs. CI builds and tests; it does not deploy, and the web build step there passes a
  guaranteed-unresolvable placeholder for `VITE_API_BASE_URL` precisely so a CI artifact can never be
  mistaken for a deployable one.
- **A custom domain or TLS certificate.** The platform hostnames are enough for a URL that works.
- **Database migrations on startup.** The API does not migrate. Schema changes are applied
  deliberately — see `CLAUDE.md` on migrations needing line-by-line review.
