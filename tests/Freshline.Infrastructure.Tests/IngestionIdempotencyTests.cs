using Freshline.Core.Ingestion;
using Freshline.Core.Model;
using Freshline.Core.Sources;
using Freshline.Infrastructure.Ingestion;
using Freshline.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace Freshline.Infrastructure.Tests;

/// <summary>
/// Shares one database across the integration tests and runs them one at a time. Without this,
/// xUnit would run the classes in parallel and they would take turns dropping the database out
/// from under one another.
/// </summary>
[CollectionDefinition(Name)]
public sealed class SqlServerCollection : ICollectionFixture<SqlServerFixture>
{
    public const string Name = "SqlServer";
}

[Collection(SqlServerCollection.Name)]
public class IngestionIdempotencyTests(SqlServerFixture fixture)
{
    private static readonly DateOnly BackfillFloor = new(2025, 7, 25);

    /// <summary>
    /// The M1 acceptance test.
    ///
    /// Two properties are asserted, not one. "The row count did not change" is the milestone's
    /// wording, but on its own it is weaker than it sounds — it would also hold if a run inserted
    /// five rows and deleted five others. So the second run is also required to insert nothing.
    ///
    /// And the first run is required to have inserted something. Without that guard the whole test
    /// passes vacuously the day the fixtures fail to load: zero rows, then zero rows, count
    /// unchanged, green.
    /// </summary>
    [Fact]
    public async Task Ingesting_the_same_window_twice_does_not_change_the_row_count()
    {
        await ResetAsync();

        ReplayConnector connector = new(SourceId.NycDohmh, NycFixtures.LoadAll(), BackfillFloor);

        IngestionRunResult first = await RunAsync(connector);
        RowCounts afterFirst = await CountRowsAsync();

        IngestionRunResult second = await RunAsync(connector);
        RowCounts afterSecond = await CountRowsAsync();

        Assert.True(first.EstablishmentsInserted > 0, "the first run inserted nothing, so this test proves nothing");
        Assert.True(first.InspectionsInserted > 0, "the first run inserted no inspections");
        Assert.True(first.ViolationsInserted > 0, "the first run inserted no violations");

        Assert.Equal(afterFirst, afterSecond);

        Assert.Equal(0, second.EstablishmentsInserted);
        Assert.Equal(0, second.InspectionsInserted);
        Assert.Equal(0, second.ViolationsInserted);

        Assert.Equal(2, connector.FetchCount);
    }

    /// <summary>
    /// The source itself publishes exact duplicates — 140 groups of them city-wide. Collapsing
    /// them is the same upsert that makes re-running a window safe, so this is the same mechanism
    /// observed from the other side.
    /// </summary>
    [Fact]
    public async Task Exact_duplicate_source_rows_are_collapsed_to_one_row()
    {
        await ResetAsync();

        IReadOnlyList<CanonicalRecord> duplicates = NycFixtures.Load("duplicate-rows.json");
        Assert.Equal(2, duplicates.Count);

        IngestionRunResult result = await RunAsync(new ReplayConnector(SourceId.NycDohmh, duplicates, BackfillFloor));

        Assert.Equal(2, result.RecordsFetched);
        Assert.Equal(1, result.RecordsDeduplicated);

        RowCounts counts = await CountRowsAsync();
        Assert.Equal(1, counts.SourceRecords);
        Assert.Equal(1, counts.Establishments);
        Assert.Equal(1, counts.Inspections);
        Assert.Equal(1, counts.Violations);
    }

    /// <summary>
    /// A run that finds nothing newer must leave the watermark alone. If it regressed to the
    /// highest date in an empty batch, every subsequent run would re-read from the floor.
    /// </summary>
    [Fact]
    public async Task An_empty_run_leaves_the_watermark_where_it_was()
    {
        await ResetAsync();

        IngestionRunResult populated = await RunAsync(
            new ReplayConnector(SourceId.NycDohmh, NycFixtures.LoadAll(), BackfillFloor));

        Assert.NotNull(populated.WatermarkAfter);

        IngestionRunResult empty = await RunAsync(
            new ReplayConnector(SourceId.NycDohmh, [], BackfillFloor));

        Assert.Equal(populated.WatermarkAfter, empty.WatermarkAfter);
    }

    /// <summary>
    /// Never-inspected establishments must survive ingestion as establishments with no inspection.
    /// They are the newly-licensed signal, and the easiest way to lose them is to treat a row with
    /// no inspection as a row worth discarding.
    /// </summary>
    [Fact]
    public async Task Never_inspected_establishments_are_stored_with_no_inspections()
    {
        await ResetAsync();

        await RunAsync(new ReplayConnector(
            SourceId.NycDohmh, NycFixtures.Load("never-inspected-sentinel.json"), BackfillFloor));

        await using FreshlineDbContext dbContext = fixture.CreateDbContext();

        List<Establishment> awaiting = await dbContext.Establishments
            .Where(e => e.IsAwaitingFirstInspection)
            .ToListAsync();

        Assert.NotEmpty(awaiting);
        Assert.Equal(0, await dbContext.Inspections.CountAsync());

        // The signal is only worth anything if it is contactable and mappable.
        Assert.All(awaiting, establishment => Assert.False(string.IsNullOrWhiteSpace(establishment.Name)));
    }

    /// <summary>
    /// Provenance, per ADR-0002: every canonical row points at the raw payload it came from, so a
    /// mapping bug is fixable by re-normalising what is stored rather than by re-fetching.
    /// </summary>
    [Fact]
    public async Task Every_stored_row_points_at_the_raw_payload_it_came_from()
    {
        await ResetAsync();

        await RunAsync(new ReplayConnector(SourceId.NycDohmh, NycFixtures.LoadAll(), BackfillFloor));

        await using FreshlineDbContext dbContext = fixture.CreateDbContext();

        Assert.False(await dbContext.Establishments.AnyAsync(e => e.SourceRecordId == 0));
        Assert.False(await dbContext.Inspections.AnyAsync(i => i.SourceRecordId == 0));
        Assert.False(await dbContext.Violations.AnyAsync(v => v.SourceRecordId == 0));

        // And the payload really is the source's JSON, not a rendering of our own model.
        SourceRecord payload = await dbContext.SourceRecords.FirstAsync();
        Assert.StartsWith("{", payload.Payload, StringComparison.Ordinal);
        Assert.Contains("\"camis\"", payload.Payload, StringComparison.Ordinal);
    }

    private async Task<IngestionRunResult> RunAsync(ReplayConnector connector)
    {
        // A fresh context per run, exactly as the worker takes a fresh scope per pass. Reusing one
        // would let EF's change tracker satisfy the second run from memory and hide a broken upsert.
        await using FreshlineDbContext dbContext = fixture.CreateDbContext();

        IngestionRunner runner = new(
            dbContext,
            [connector],
            TimeProvider.System,
            NullLogger<IngestionRunner>.Instance);

        return await runner.RunAsync(connector.SourceId, CancellationToken.None);
    }

    private async Task<RowCounts> CountRowsAsync()
    {
        await using FreshlineDbContext dbContext = fixture.CreateDbContext();

        return new RowCounts(
            await dbContext.Establishments.CountAsync(),
            await dbContext.Inspections.CountAsync(),
            await dbContext.Violations.CountAsync(),
            await dbContext.SourceRecords.CountAsync());
    }

    private async Task ResetAsync()
    {
        await using FreshlineDbContext dbContext = fixture.CreateDbContext();

        // Child-first, because the foreign keys to SourceRecords are Restrict rather than Cascade.
        await dbContext.Violations.ExecuteDeleteAsync();
        await dbContext.Inspections.ExecuteDeleteAsync();
        await dbContext.Establishments.ExecuteDeleteAsync();
        await dbContext.SourceRecords.ExecuteDeleteAsync();
        await dbContext.SourceWatermarks.ExecuteDeleteAsync();
    }

    private sealed record RowCounts(int Establishments, int Inspections, int Violations, int SourceRecords);
}
