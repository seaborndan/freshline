# Local development

Things that cost time to work out once and should not cost it twice.

## Toolchain: Visual Studio 2022 will not work

**Visual Studio 2022 cannot build this project**, and the reason is not the `.slnx` solution file.

Every project here targets `net10.0`. Per Microsoft's documentation and the dotnet/sdk issue tracker,
VS 2022 17.14 can *load* the .NET 10 SDK but only target .NET 9 and earlier — **targeting `net10.0`
requires Visual Studio 2026 (18.0+)**. There is no 17.x band mapped to the .NET 10 SDK, so no version
of VS 2022 is a way out of this.

Separately, `.slnx` arrived as a preview feature in VS 17.10 and became properly supported around
17.14, behind *Tools → Options → Environment → Preview Features → "Use Solution File Persistence
Model"*. Converting the solution back to `.sln` would not help, because the framework target is the
real blocker.

**Use one of:**

- **VS Code** with the **C# Dev Kit** extension. Open the folder; it does not need a solution file.
- **Visual Studio 2026** Community. Installs side by side with 2022.
- **Rider.**

Nothing in this repository requires an IDE — `dotnet build`, `dotnet test` and `dotnet ef` all work
from a terminal, which is how CI runs them.

## Running it

```bash
docker compose up -d --wait          # SQL Server, waits for the healthcheck

dotnet tool restore                  # pins dotnet-ef to the version in .config/dotnet-tools.json

export FRESHLINE_CONNECTIONSTRING="Server=localhost,1433;Database=Freshline;User Id=sa;Password=<the compose password>;TrustServerCertificate=True"
dotnet ef database update --project src/Freshline.Infrastructure

export ConnectionStrings__Freshline="$FRESHLINE_CONNECTIONSTRING"
export Ingestion__RunOnce=true
dotnet run --project src/Freshline.Ingestion    # one pass, then exits
```

The password is the throwaway local one in `docker-compose.yml`. It is not a secret and guards
nothing but a container of public open data. No real credential is ever read from source — see the
security rules in `CLAUDE.md`.

**Docker Desktop's process running is not the same as its engine being up.** Seeing it in the tray
proves nothing; `docker info` is the check that matters, and `docker compose up` against a
not-yet-ready engine fails with a message about the pipe rather than about Docker.

`dotnet test` needs the container running. The integration tests **fail rather than skip** when it is
absent, deliberately: a silently skipped test looks exactly like a passing one.

**A running API locks its own DLLs on Windows**, so a `dotnet run` left in another terminal makes
`dotnet test` fail with MSB3027 — a file-in-use error that reads like a corrupted build and is not
one:

```powershell
Get-Process -Name "Freshline.Api" -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Browsing the database

The connection string above is known-good from Windows — it is what the worker and the integration
tests use.

### VS Code, SQL Server (mssql) extension

`Ctrl+Shift+P` → **MS SQL: Connect** → **Create Connection String**, and paste:

```
Server=localhost,1433;Database=Freshline;User Id=sa;Password=<the compose password>;TrustServerCertificate=True;Encrypt=True
```

Two things that waste an afternoon if you hit them cold:

- **The port separator is a comma, not a colon.** `localhost:1433` produces
  *"error: 25 — Connection string is not valid"*, whose message unhelpfully leads with "server was
  not found". Use `localhost,1433`, or just `localhost` since 1433 is the default.
- **`TrustServerCertificate=True` is not optional.** The container ships a self-signed certificate and
  recent drivers encrypt by default. Without it you get a second, different error immediately after
  fixing the first.

If the connection form's **Database Name** dropdown fails to populate, type `Freshline` in directly.
The extension tries to enumerate databases before the profile is complete and that lookup can fail on
its own.

If `localhost` still misbehaves, try `127.0.0.1,1433` — on Docker Desktop with WSL2 the only
listeners on 1433 may be IPv6.

### The object explorer's row counts are not row counts

The extension's table preview virtualises: it renders a window of rows and fetches more as you
scroll. Seeing "50 entries" tells you what the grid chose to render, not what exists. Use a query:

```sql
SELECT
    (SELECT COUNT(*) FROM Establishments) AS Establishments,
    (SELECT COUNT(*) FROM Inspections)    AS Inspections,
    (SELECT COUNT(*) FROM Violations)     AS Violations,
    (SELECT COUNT(*) FROM SourceRecords)  AS RawPayloads;
```

### Command line, no install

```bash
docker exec freshline-sql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "<the compose password>" -C -d Freshline \
  -Q "SELECT COUNT(*) FROM Establishments;"
```

Note this runs *inside* the container, so it proves nothing about whether the port is reachable from
Windows. `Test-NetConnection localhost -Port 1433` is the check for that.

## Queries worth having

```sql
-- One establishment, the whole shape
SELECT e.Name, e.Cuisine, e.AddressLine, i.InspectedOn, i.RawGrade, i.RawScore, v.Code, v.Description
FROM Establishments e
JOIN Inspections i ON i.EstablishmentId = e.Id
JOIN Violations  v ON v.InspectionId    = i.Id
WHERE e.Name = 'GLOBE BAR'
ORDER BY i.InspectedOn DESC;

-- Pest-control leads: mice, harborage, flies — the product in one query
SELECT e.Name, e.Phone, e.AddressLine, e.PostalCode, i.InspectedOn, v.Code
FROM Violations v
JOIN Inspections i    ON i.Id = v.InspectionId
JOIN Establishments e ON e.Id = i.EstablishmentId
WHERE v.Code IN ('04L','08A','04N')
ORDER BY i.InspectedOn DESC;

-- Newly permitted, never inspected: the greenfield list
SELECT Name, Phone, AddressLine, Locality, PostalCode
FROM Establishments WHERE IsAwaitingFirstInspection = 1;

-- The raw payload retained for any row, exactly as NYC published it
SELECT TOP 1 ExternalId, Payload FROM SourceRecords;
```

## Resetting

```bash
docker compose down          # stops the container, keeps the data
docker compose down -v       # ALSO deletes the volume and every ingested row
```

A full re-ingest from an empty database takes a few minutes: about 104 seconds of fetching for the
current scope, plus migrations. Nothing is lost permanently — the source is public and the connector
backfills from `Sources:NycDohmh:BackfillFloor`.
