using Freshline.Core.Model;
using Freshline.Core.Sources;
using Freshline.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Freshline.Api.Tests;

/// <summary>
/// Shares one seeded database and one running host across the endpoint tests, and stops xUnit
/// running the classes in parallel — which would have them taking turns dropping the database out
/// from under one another.
/// </summary>
[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFixture>
{
    public const string Name = "Api";
}

/// <summary>
/// A real SQL Server database built from the committed migrations, seeded with a small, fixed set
/// of rows, and a real API host in front of it.
///
/// <para><strong>Why seeded rather than pointed at the ingested database.</strong> The ingested
/// database is real data that changes every time NYC publishes, so an assertion against it would
/// be true on Tuesday and false on Wednesday. The rows below are chosen to carry the states the
/// endpoints have to get right — a never-inspected establishment, an inspection with no violations,
/// a null grade, missing coordinates, and two establishments sharing a name — so each is asserted
/// against a known answer.</para>
///
/// <para>Like the Infrastructure integration tests, these fail rather than skip when SQL Server is
/// absent. A silently skipped test looks exactly like a passing one.</para>
/// </summary>
public sealed class ApiFixture : IAsyncLifetime
{
    /// <summary>
    /// Its own database, separate from the one the Infrastructure tests drop and recreate, so the
    /// two projects can run at the same time without destroying each other's fixtures.
    /// </summary>
    private const string DefaultConnectionString =
        "Server=localhost,1433;Database=Freshline_ApiTests;User Id=sa;Password=Freshline_Local_2026!;TrustServerCertificate=True";

    private FreshlineApiFactory? _factory;

    public string ConnectionString { get; } =
        Environment.GetEnvironmentVariable("FRESHLINE_APITEST_CONNECTIONSTRING") ?? DefaultConnectionString;

    public SeededIds Seeded { get; private set; } = null!;

    public HttpClient CreateClient() => _factory!.CreateClient();

    /// <summary>The running host's container, for the few tests that assert on wiring rather than
    /// on a response.</summary>
    public IServiceProvider Services => _factory!.Services;

    public async Task InitializeAsync()
    {
        await using FreshlineDbContext dbContext = CreateDbContext();

        try
        {
            await dbContext.Database.EnsureDeletedAsync();
            await dbContext.Database.MigrateAsync();
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException(
                "Could not reach SQL Server. These are integration tests and they are supposed to " +
                "need a real database: run `docker compose up -d --wait`, or set " +
                "FRESHLINE_APITEST_CONNECTIONSTRING to point somewhere else. They fail rather than " +
                $"skip on purpose. Connection string in use: {ConnectionString}",
                exception);
        }

        Seeded = await SeedAsync(dbContext);

        _factory = new FreshlineApiFactory(ConnectionString);
    }

    public Task DisposeAsync()
    {
        _factory?.Dispose();
        return Task.CompletedTask;
    }

    public FreshlineDbContext CreateDbContext()
        => new(new DbContextOptionsBuilder<FreshlineDbContext>()
            .UseSqlServer(ConnectionString, sqlServer => sqlServer.UseNetTopologySuite())
            .Options);

    private static async Task<SeededIds> SeedAsync(FreshlineDbContext dbContext)
    {
        DateTimeOffset fetchedAt = new(2026, 7, 26, 0, 0, 0, TimeSpan.Zero);

        // One provenance row for the whole fixture. Every canonical entity carries a foreign key to
        // the raw payload it came from; the payload's contents do not matter to these tests, only
        // that the relationship is satisfiable.
        SourceRecord sourceRecord = new()
        {
            SourceId = SourceId.NycDohmh,
            ExternalId = "fixture:0",
            FetchedAtUtc = fetchedAt,
            Payload = """{"note":"api test fixture"}""",
        };

        dbContext.SourceRecords.Add(sourceRecord);
        await dbContext.SaveChangesAsync();

        // Coordinates sit inside the viewport used for the M3 measurements, so the map tests added
        // later can reuse the same box.
        Establishment inspectedTwice = NewEstablishment(
            sourceRecord, "1001", "FIXTURE DINER", "American", 40.7200, -74.0010, fetchedAt);
        inspectedTwice.Phone = "2125550100";
        inspectedTwice.AddressLine = "1 FIXTURE STREET";
        inspectedTwice.Locality = "Manhattan";
        inspectedTwice.PostalCode = "10001";

        // The never-inspected sentinel: a permit, an address, no cuisine and no inspection at all.
        Establishment neverInspected = NewEstablishment(
            sourceRecord, "1002", "FIXTURE NEWLY PERMITTED", cuisine: null, 40.7210, -74.0020, fetchedAt);
        neverInspected.IsAwaitingFirstInspection = true;
        neverInspected.Locality = "Manhattan";

        // NYC publishes zeroed coordinates for some rows; the mapper drops both components together,
        // so an establishment can exist with neither. It must still be returnable.
        Establishment withoutCoordinates = NewEstablishment(
            sourceRecord, "1003", "FIXTURE NO COORDINATES", "Pizza", latitude: null, longitude: null, fetchedAt);

        // Two establishments sharing a name. 6,546 real establishments do, and DUNKIN alone appears
        // 307 times — which is why the list endpoint's cursor cannot sort on name alone.
        Establishment sharedNameFirst = NewEstablishment(
            sourceRecord, "1004", "FIXTURE SHARED NAME", "Coffee", 40.7220, -73.9990, fetchedAt);
        Establishment sharedNameSecond = NewEstablishment(
            sourceRecord, "1005", "FIXTURE SHARED NAME", "Coffee", 40.7230, -73.9980, fetchedAt);

        // A name carrying every character that could break the cursor if it were spelled naively:
        // a colon (the codec's own separator), an apostrophe, an ampersand and a plus. Real names in
        // this data contain all of them — the very first row of the live list is #1 GARDEN CHINESE
        // RESTAURANT, whose leading # would be a fragment delimiter in an unencoded URL.
        Establishment awkwardName = NewEstablishment(
            sourceRecord, "1006", "FIXTURE O'BRIEN: BAR & GRILL + CAFE", "Irish", 40.7240, -73.9970, fetchedAt);

        dbContext.Establishments.AddRange(
            inspectedTwice, neverInspected, withoutCoordinates, sharedNameFirst, sharedNameSecond,
            awkwardName);
        await dbContext.SaveChangesAsync();

        // The newer inspection: graded, with two violations, one critical and one not.
        Inspection newer = new()
        {
            SourceId = SourceId.NycDohmh,
            ExternalId = "1001:2026-06-01:Cycle Inspection",
            EstablishmentId = inspectedTwice.Id,
            InspectedOn = new DateOnly(2026, 6, 1),
            InspectionType = "Cycle Inspection",
            Action = "Violations were cited in the following area(s).",
            RawGrade = "A",
            RawScore = 12,
            Outcome = InspectionOutcome.Good,
            NormalisedSeverity = 12,
            ClosedByAuthority = false,
            FetchedAtUtc = fetchedAt,
            SourceRecordId = sourceRecord.Id,
        };

        // The older one: ungraded, no score, and no violations at all. 1,045 real inspections cite
        // nothing, and a null grade is the majority case rather than an error.
        Inspection older = new()
        {
            SourceId = SourceId.NycDohmh,
            ExternalId = "1001:2025-11-14:Cycle Inspection",
            EstablishmentId = inspectedTwice.Id,
            InspectedOn = new DateOnly(2025, 11, 14),
            InspectionType = "Cycle Inspection",
            Action = "No violations were recorded at the time of this inspection.",
            RawGrade = null,
            RawScore = null,
            Outcome = InspectionOutcome.Ungraded,
            NormalisedSeverity = null,
            ClosedByAuthority = false,
            FetchedAtUtc = fetchedAt,
            SourceRecordId = sourceRecord.Id,
        };

        dbContext.Inspections.AddRange(newer, older);
        await dbContext.SaveChangesAsync();

        dbContext.Violations.AddRange(
            new Violation
            {
                SourceId = SourceId.NycDohmh,
                ExternalId = $"{newer.ExternalId}:04L",
                InspectionId = newer.Id,
                Code = "04L",
                Description = "Evidence of mice or live mice present.",
                IsCritical = true,
                FetchedAtUtc = fetchedAt,
                SourceRecordId = sourceRecord.Id,
            },
            new Violation
            {
                SourceId = SourceId.NycDohmh,
                ExternalId = $"{newer.ExternalId}:10F",
                InspectionId = newer.Id,
                Code = "10F",
                Description = "Non-food contact surface improperly constructed.",
                // Null, not false. NYC publishes "Not Applicable" as a third state and flattening it
                // would assert the source said something it did not.
                IsCritical = null,
                FetchedAtUtc = fetchedAt,
                SourceRecordId = sourceRecord.Id,
            });

        await dbContext.SaveChangesAsync();

        return new SeededIds
        {
            InspectedTwiceId = inspectedTwice.Id,
            NeverInspectedId = neverInspected.Id,
            WithoutCoordinatesId = withoutCoordinates.Id,
            SharedNameFirstId = sharedNameFirst.Id,
            SharedNameSecondId = sharedNameSecond.Id,
            AwkwardNameId = awkwardName.Id,
            NewerInspectionId = newer.Id,
            OlderInspectionId = older.Id,
        };
    }

    private static Establishment NewEstablishment(
        SourceRecord sourceRecord,
        string externalId,
        string name,
        string? cuisine,
        double? latitude,
        double? longitude,
        DateTimeOffset fetchedAt)
        => new()
        {
            SourceId = SourceId.NycDohmh,
            ExternalId = externalId,
            Name = name,
            Cuisine = cuisine,
            Latitude = latitude,
            Longitude = longitude,
            // Derived from the coordinates on write, exactly as the ingestion runner does it, so the
            // fixture cannot disagree with production about coordinate order.
            Location = GeoPoint.FromLatitudeLongitude(latitude, longitude),
            FirstSeenUtc = fetchedAt,
            LastSeenUtc = fetchedAt,
            SourceRecordId = sourceRecord.Id,
        };
}

/// <summary>The database assigns the keys, so the tests are told what they turned out to be.</summary>
public sealed record SeededIds
{
    public required int InspectedTwiceId { get; init; }
    public required int NeverInspectedId { get; init; }
    public required int WithoutCoordinatesId { get; init; }
    public required int SharedNameFirstId { get; init; }
    public required int SharedNameSecondId { get; init; }
    public required int AwkwardNameId { get; init; }

    /// <summary>Every establishment the fixture seeds. Paging tests assert against this total.</summary>
    public int TotalEstablishments => 6;
    public required int NewerInspectionId { get; init; }
    public required int OlderInspectionId { get; init; }
}
