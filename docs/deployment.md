# Deployment

## Resume here — state as of 2026-07-27

Deployment was started and deliberately paused. **Nothing is running and nothing is being billed.**

**Done already:**

- Azure account `joemama808cruiser@gmail.com`, free trial, subscription `Azure subscription 1`
  (`7d5420b1-3191-42a2-bf57-fa3ad8433388`). An earlier account had already spent its trial, which is
  why this one exists.
- Resource providers registered: `Microsoft.App`, `Microsoft.OperationalInsights`, `Microsoft.Sql`.
- **Resource group `freshline` created, in `eastus`.** Empty. An empty resource group costs nothing.

**The plan, decided and not yet executed.** Every piece is chosen to sit inside a *permanent* free
allowance rather than inside the trial credit, because the requirement is zero cost rather than low
cost:

| Piece | Choice | Why this one |
|---|---|---|
| Image registry | **ghcr.io**, public | Free for public repos, and `seaborndan/freshline` is public. Azure Container Registry has no free tier — Basic is ~$5/month, and it is the only piece that would have produced a bill. |
| API | Container Apps, **scaled to zero** | Docs: *"When a revision is scaled to zero replicas, no resource consumption charges are incurred."* Health probes are not billable either. |
| Environment logging | **`--logs-destination none`** | A Container Apps environment otherwise creates a Log Analytics workspace, which bills for ingestion separately. Costs queryable log history; worth it here. |
| Database | Azure SQL **free offer**, via the portal only | 100,000 vCore-seconds and 32 GB per month, lifetime of the subscription. `az sql db create` would produce a normal billable database. |
| Front end | Static Web Apps **Free** tier | Hosting, SSL and 100 GB bandwidth. |

**The accepted trade:** scale-to-zero and database auto-pause are exactly what keeps this at zero, and
exactly what makes the first visitor wait through a container start plus a database resume. That is a
deliberate choice — zero cost was the requirement and latency was explicitly not.

### Steps remaining, in order

**1. Grant the package-push scope** (once, on the workstation):

```bash
gh auth refresh -s write:packages
```

**2. Create the database — in the portal, not the CLI.**

The free offer only applies through this flow. Creating it any other way produces a billable database
that looks identical afterwards.

1. Go to **[aka.ms/azuresqlhub](https://aka.ms/azuresqlhub)** → **Create a database** pane → **Start free**
2. **Confirm the green "Free offer applied!" banner is present.** If it is missing, stop — the
   database being created is a paid one.
3. Subscription `Azure subscription 1`; resource group `freshline`; database name `freshline`
4. Server: create new, globally-unique name, **location East US**, SQL authentication, admin login and
   password — **record them, the container app needs them**
5. **Behavior when free limit reached → "Auto-pause the database until next month."** The other option
   keeps it online and charges the overage.
6. **Confirm the Cost summary card reads $0.00/month.** If it does not, stop.
7. **Networking tab → "Allow Azure services and resources to access this server" → Yes.** The
   container cannot connect otherwise.
8. Review + create.

**East US is not reversible.** The first free database pins the region for every free database in the
subscription.

**3. Everything after that is CLI work**, in this order — the ordering is forced, see "The ordering
problem" below:

```bash
# a. push the image
docker build -t ghcr.io/seaborndan/freshline-api:v1 .
gh auth token | docker login ghcr.io -u seaborndan --password-stdin
docker push ghcr.io/seaborndan/freshline-api:v1
#    then mark the package public in GitHub → Packages → freshline-api → settings,
#    so Container Apps can pull it without credentials

# b. environment, with logging off so no Log Analytics workspace is created
az containerapp env create -g freshline -n freshline-env -l eastus --logs-destination none

# c. the app: scaled to zero, port 8080, one proxy hop, no CORS origin yet
az containerapp create -g freshline -n freshline-api --environment freshline-env \
  --image ghcr.io/seaborndan/freshline-api:v1 \
  --target-port 8080 --ingress external \
  --min-replicas 0 --max-replicas 1 \
  --cpu 0.25 --memory 0.5Gi \
  --env-vars "Ingress__ProxyHopCount=1" \
             "ConnectionStrings__Freshline=<from step 2>"

# d. tighten auto-pause from the 60-minute default to the 15-minute minimum
az sql db update -g freshline -s <server> -n freshline --auto-pause-delay 15

# e. front end, built against the API's real URL
cd web && VITE_API_BASE_URL=https://<api-fqdn> npm run build

# f. deploy web/dist to Static Web Apps (free tier), then — the step that looks
#    optional and is not — set the API's CORS origin to the site's origin:
az containerapp update -g freshline -n freshline-api \
  --set-env-vars "Cors__AllowedOrigins__0=https://<web-origin>"
```

**4. Verify**, using the three checks in "Verify the deploy" below. The third — a forged
`X-Forwarded-For` against the real ingress — is the only proof that `ProxyHopCount: 1` matches the
real topology, and no test in this repository can establish it.

**5. Measure the cold start.** Time a first request after the app has been idle long enough to scale
to zero and pause. That number is unknown, is currently guessed from documentation as "on the order of
one minute", and belongs in `docs/performance.md` **only once measured**.

### Two things that will bite later if not written down

- **A `$1` budget alert was attempted and not created.** `az consumption budget create` rejected it
  (`Invalid budget configuration, please use filter interface with 2019-05-01-preview version`). Set
  it in the portal instead: *Cost Management → Budgets → Add*. The design intends zero spend, so any
  spend at all is worth an email.
- **At day 30 the trial ends and Azure disables the resources rather than billing.** The URL goes dark
  until the subscription is upgraded to pay-as-you-go. After upgrading, the free grants above still
  apply — the upgrade puts a real card behind the account, it does not start a charge on its own.


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
