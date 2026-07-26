using Freshline.Core.Ingestion;
using Freshline.Core.Model;
using Freshline.Core.Sources;
using Freshline.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Freshline.Infrastructure.Ingestion;

/// <summary>
/// Runs one ingestion pass: read the watermark, ask the connector for a window, deduplicate,
/// upsert, advance the watermark. All inside one transaction, so a failure halfway through cannot
/// leave rows written and the watermark moved past them — which would make the missing records
/// invisible to every subsequent run.
/// </summary>
public sealed class IngestionRunner(
    FreshlineDbContext dbContext,
    IEnumerable<ISourceConnector> connectors,
    TimeProvider timeProvider,
    ILogger<IngestionRunner> logger) : IIngestionRunner
{
    /// <summary>
    /// SQL Server caps a single command at 2,100 parameters, and EF turns
    /// <c>Where(x =&gt; keys.Contains(x.ExternalId))</c> into one parameter per key. Lookups are
    /// chunked below that ceiling so a larger window fails on time rather than on a parameter limit.
    /// </summary>
    private const int LookupChunkSize = 1_000;

    public async Task<IngestionRunResult> RunAsync(SourceId sourceId, CancellationToken cancellationToken)
    {
        ISourceConnector connector = connectors.SingleOrDefault(c => c.SourceId == sourceId)
            ?? throw new InvalidOperationException($"No connector is registered for source {sourceId}.");

        DateTimeOffset startedAtUtc = timeProvider.GetUtcNow();

        SourceWatermark? watermark = await dbContext.SourceWatermarks
            .SingleOrDefaultAsync(w => w.SourceId == sourceId, cancellationToken);

        DateOnly? watermarkBefore = watermark?.HighWaterMark;
        string scopeSignature = connector.ScopeSignature;

        // A watermark is only a valid statement about coverage for the scope it was earned under.
        // If the connector is now asking for something wider, the stored position is still true and
        // no longer means anything — starting from it would leave the newly-included records with
        // no history before that date, silently, while the row count grew and the logs looked fine.
        bool scopeChanged =
            watermark is not null &&
            !string.Equals(watermark.ScopeSignature, scopeSignature, StringComparison.Ordinal);

        if (scopeChanged)
        {
            logger.LogWarning(
                "{Source}: ingestion scope changed from '{Previous}' to '{Current}'. Discarding the " +
                "watermark at {Watermark} and backfilling from the floor, because that position was " +
                "only ever true of the previous scope.",
                sourceId, watermark!.ScopeSignature ?? "(none)", scopeSignature, watermarkBefore);

            watermarkBefore = null;
        }

        IngestionWindow window = connector.GetWindow(watermarkBefore);

        List<CanonicalRecord> fetched = [];
        await foreach (CanonicalRecord record in connector
            .FetchAsync(window, cancellationToken)
            .WithCancellation(cancellationToken))
        {
            fetched.Add(record);
        }

        // Collapse duplicates on the source row's natural key. NYC publishes 140 groups of exact
        // duplicates city-wide; they were verified to agree on every normalisation-relevant field,
        // so last-one-wins is lossless rather than an arbitrary choice. See ADR-0003.
        Dictionary<string, CanonicalRecord> deduplicated = new(StringComparer.Ordinal);
        foreach (CanonicalRecord record in fetched)
        {
            deduplicated[record.ExternalId] = record;
        }

        logger.LogInformation(
            "{Source}: fetched {Fetched} rows from {From}, {Deduplicated} after deduplication",
            sourceId, fetched.Count, window.From, deduplicated.Count);

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        IReadOnlyList<CanonicalRecord> records = [.. deduplicated.Values];

        (int rawInserted, _, Dictionary<string, long> rawIdsByKey) =
            await UpsertSourceRecordsAsync(sourceId, records, cancellationToken);

        (int establishmentsInserted, int establishmentsUpdated, Dictionary<string, int> establishmentIds) =
            await UpsertEstablishmentsAsync(sourceId, records, rawIdsByKey, cancellationToken);

        (int inspectionsInserted, int inspectionsUpdated, Dictionary<string, int> inspectionIds) =
            await UpsertInspectionsAsync(sourceId, records, rawIdsByKey, establishmentIds, cancellationToken);

        (int violationsInserted, int violationsUpdated) =
            await UpsertViolationsAsync(sourceId, records, rawIdsByKey, inspectionIds, cancellationToken);

        DateOnly? watermarkAfter = await AdvanceWatermarkAsync(
            sourceId, watermark, watermarkBefore, scopeSignature, records, startedAtUtc, cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        logger.LogInformation(
            "{Source}: {RawInserted} raw payloads stored; establishments +{EstIns}/~{EstUpd}; " +
            "inspections +{InsIns}/~{InsUpd}; violations +{VioIns}/~{VioUpd}; watermark {Before} -> {After}",
            sourceId, rawInserted, establishmentsInserted, establishmentsUpdated,
            inspectionsInserted, inspectionsUpdated, violationsInserted, violationsUpdated,
            watermarkBefore, watermarkAfter);

        return new IngestionRunResult
        {
            SourceId = sourceId,
            Window = window,
            RecordsFetched = fetched.Count,
            RecordsDeduplicated = deduplicated.Count,
            EstablishmentsInserted = establishmentsInserted,
            EstablishmentsUpdated = establishmentsUpdated,
            InspectionsInserted = inspectionsInserted,
            InspectionsUpdated = inspectionsUpdated,
            ViolationsInserted = violationsInserted,
            ViolationsUpdated = violationsUpdated,
            WatermarkBefore = watermarkBefore,
            WatermarkAfter = watermarkAfter,
        };
    }

    private async Task<(int Inserted, int Updated, Dictionary<string, long> IdsByKey)> UpsertSourceRecordsAsync(
        SourceId sourceId,
        IReadOnlyList<CanonicalRecord> records,
        CancellationToken cancellationToken)
    {
        string[] keys = [.. records.Select(r => r.ExternalId)];
        Dictionary<string, SourceRecord> existing =
            await LoadByExternalIdAsync(dbContext.SourceRecords, sourceId, keys, r => r.ExternalId, cancellationToken);

        int inserted = 0;
        int updated = 0;

        foreach (CanonicalRecord record in records)
        {
            if (existing.TryGetValue(record.ExternalId, out SourceRecord? stored))
            {
                // The payload is refreshed rather than appended to. Restatement is the normal
                // case for this source, and what matters is the current published truth plus the
                // ability to re-normalise it — not a version history nobody has asked for.
                stored.Payload = record.RawPayload;
                stored.FetchedAtUtc = record.FetchedAtUtc;
                updated++;
            }
            else
            {
                dbContext.SourceRecords.Add(new SourceRecord
                {
                    SourceId = sourceId,
                    ExternalId = record.ExternalId,
                    Payload = record.RawPayload,
                    FetchedAtUtc = record.FetchedAtUtc,
                });
                inserted++;
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        Dictionary<string, long> idsByKey =
            await LoadIdMapAsync(dbContext.SourceRecords, sourceId, keys, r => r.ExternalId, r => r.Id, cancellationToken);

        return (inserted, updated, idsByKey);
    }

    private async Task<(int Inserted, int Updated, Dictionary<string, int> IdsByKey)> UpsertEstablishmentsAsync(
        SourceId sourceId,
        IReadOnlyList<CanonicalRecord> records,
        Dictionary<string, long> rawIdsByKey,
        CancellationToken cancellationToken)
    {
        // One establishment appears on every row of every one of its inspections. The row that
        // describes it best is the most recent one; a record with no inspection sorts last, so an
        // establishment that has since been inspected stops being marked as awaiting its first.
        Dictionary<string, CanonicalRecord> latestPerEstablishment = records
            .GroupBy(r => r.Establishment.ExternalId, StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => group
                    .OrderByDescending(r => r.Inspection?.InspectedOn ?? DateOnly.MinValue)
                    .First(),
                StringComparer.Ordinal);

        string[] keys = [.. latestPerEstablishment.Keys];
        Dictionary<string, Establishment> existing =
            await LoadByExternalIdAsync(dbContext.Establishments, sourceId, keys, e => e.ExternalId, cancellationToken);

        int inserted = 0;
        int updated = 0;

        foreach ((string externalId, CanonicalRecord record) in latestPerEstablishment)
        {
            CanonicalEstablishment source = record.Establishment;
            long sourceRecordId = rawIdsByKey[record.ExternalId];

            if (existing.TryGetValue(externalId, out Establishment? establishment))
            {
                Apply(establishment, source, record.FetchedAtUtc, sourceRecordId);
                establishment.LastSeenUtc = record.FetchedAtUtc;
                updated++;
            }
            else
            {
                establishment = new Establishment
                {
                    SourceId = sourceId,
                    ExternalId = externalId,
                    Name = source.Name,
                    FirstSeenUtc = record.FetchedAtUtc,
                    LastSeenUtc = record.FetchedAtUtc,
                    SourceRecordId = sourceRecordId,
                };
                Apply(establishment, source, record.FetchedAtUtc, sourceRecordId);
                dbContext.Establishments.Add(establishment);
                inserted++;
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        Dictionary<string, int> idsByKey =
            await LoadIdMapAsync(dbContext.Establishments, sourceId, keys, e => e.ExternalId, e => e.Id, cancellationToken);

        return (inserted, updated, idsByKey);

        static void Apply(Establishment target, CanonicalEstablishment source, DateTimeOffset fetchedAtUtc, long sourceRecordId)
        {
            target.Name = source.Name;
            target.Cuisine = source.Cuisine;
            target.Phone = source.Phone;
            target.AddressLine = source.AddressLine;
            target.Locality = source.Locality;
            target.PostalCode = source.PostalCode;
            target.Latitude = source.Latitude;
            target.Longitude = source.Longitude;
            // Derived on write, never edited independently of the two values above.
            target.Location = GeoPoint.FromLatitudeLongitude(source.Latitude, source.Longitude);
            target.IsAwaitingFirstInspection = source.IsAwaitingFirstInspection;
            target.SourceRecordId = sourceRecordId;
        }
    }

    private async Task<(int Inserted, int Updated, Dictionary<string, int> IdsByKey)> UpsertInspectionsAsync(
        SourceId sourceId,
        IReadOnlyList<CanonicalRecord> records,
        Dictionary<string, long> rawIdsByKey,
        Dictionary<string, int> establishmentIds,
        CancellationToken cancellationToken)
    {
        // Every violation row of one inspection repeats that inspection's fields, so the rows in a
        // group are interchangeable for this purpose. Taking the first is not arbitrary: the
        // duplicate analysis in ADR-0003 confirmed the repeated fields agree.
        Dictionary<string, CanonicalRecord> byInspection = records
            .Where(r => r.Inspection is not null)
            .GroupBy(r => r.Inspection!.ExternalId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        string[] keys = [.. byInspection.Keys];
        Dictionary<string, Inspection> existing =
            await LoadByExternalIdAsync(dbContext.Inspections, sourceId, keys, i => i.ExternalId, cancellationToken);

        int inserted = 0;
        int updated = 0;

        foreach ((string externalId, CanonicalRecord record) in byInspection)
        {
            CanonicalInspection source = record.Inspection!;
            long sourceRecordId = rawIdsByKey[record.ExternalId];
            int establishmentId = establishmentIds[record.Establishment.ExternalId];

            if (existing.TryGetValue(externalId, out Inspection? inspection))
            {
                Apply(inspection, source, record.FetchedAtUtc, sourceRecordId);
                updated++;
            }
            else
            {
                inspection = new Inspection
                {
                    SourceId = sourceId,
                    ExternalId = externalId,
                    EstablishmentId = establishmentId,
                    InspectedOn = source.InspectedOn,
                };
                Apply(inspection, source, record.FetchedAtUtc, sourceRecordId);
                dbContext.Inspections.Add(inspection);
                inserted++;
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        Dictionary<string, int> idsByKey =
            await LoadIdMapAsync(dbContext.Inspections, sourceId, keys, i => i.ExternalId, i => i.Id, cancellationToken);

        return (inserted, updated, idsByKey);

        static void Apply(Inspection target, CanonicalInspection source, DateTimeOffset fetchedAtUtc, long sourceRecordId)
        {
            target.InspectedOn = source.InspectedOn;
            target.InspectionType = source.InspectionType;
            target.Action = source.Action;
            target.RawGrade = source.RawGrade;
            target.RawScore = source.RawScore;
            target.Outcome = source.Outcome;
            target.NormalisedSeverity = source.NormalisedSeverity;
            target.ClosedByAuthority = source.ClosedByAuthority;
            target.FetchedAtUtc = fetchedAtUtc;
            target.SourceRecordId = sourceRecordId;
        }
    }

    private async Task<(int Inserted, int Updated)> UpsertViolationsAsync(
        SourceId sourceId,
        IReadOnlyList<CanonicalRecord> records,
        Dictionary<string, long> rawIdsByKey,
        Dictionary<string, int> inspectionIds,
        CancellationToken cancellationToken)
    {
        Dictionary<string, CanonicalRecord> byViolation = records
            .Where(r => r.Violation is not null)
            .GroupBy(r => r.Violation!.ExternalId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        string[] keys = [.. byViolation.Keys];
        Dictionary<string, Violation> existing =
            await LoadByExternalIdAsync(dbContext.Violations, sourceId, keys, v => v.ExternalId, cancellationToken);

        int inserted = 0;
        int updated = 0;

        foreach ((string externalId, CanonicalRecord record) in byViolation)
        {
            CanonicalViolation source = record.Violation!;
            long sourceRecordId = rawIdsByKey[record.ExternalId];
            int inspectionId = inspectionIds[record.Inspection!.ExternalId];

            if (existing.TryGetValue(externalId, out Violation? violation))
            {
                Apply(violation, source, record.FetchedAtUtc, sourceRecordId);
                updated++;
            }
            else
            {
                violation = new Violation
                {
                    SourceId = sourceId,
                    ExternalId = externalId,
                    InspectionId = inspectionId,
                    Code = source.Code,
                };
                Apply(violation, source, record.FetchedAtUtc, sourceRecordId);
                dbContext.Violations.Add(violation);
                inserted++;
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        return (inserted, updated);

        static void Apply(Violation target, CanonicalViolation source, DateTimeOffset fetchedAtUtc, long sourceRecordId)
        {
            target.Code = source.Code;
            target.Description = source.Description;
            target.IsCritical = source.IsCritical;
            target.FetchedAtUtc = fetchedAtUtc;
            target.SourceRecordId = sourceRecordId;
        }
    }

    private async Task<DateOnly?> AdvanceWatermarkAsync(
        SourceId sourceId,
        SourceWatermark? watermark,
        DateOnly? watermarkBefore,
        string scopeSignature,
        IReadOnlyList<CanonicalRecord> records,
        DateTimeOffset startedAtUtc,
        CancellationToken cancellationToken)
    {
        // Records for never-inspected establishments carry no inspection at all — the connector
        // resolved that sentinel on the way in — so they contribute nothing here and cannot drag
        // the watermark backwards. That the runner needs no special case for it is the point of
        // translating at the connector rather than downstream.
        DateOnly? highestInBatch = records
            .Select(r => r.Inspection?.InspectedOn)
            .Where(date => date is not null)
            .Max();

        // Never regress. A window that returns nothing new must leave the watermark where it was,
        // or the next run would re-read ground already covered and the run after that would too.
        DateOnly? watermarkAfter = (watermarkBefore, highestInBatch) switch
        {
            (null, null) => null,
            (null, { } batch) => batch,
            ({ } before, null) => before,
            ({ } before, { } batch) => batch > before ? batch : before,
        };

        if (watermark is null)
        {
            watermark = new SourceWatermark { SourceId = sourceId };
            dbContext.SourceWatermarks.Add(watermark);
        }

        watermark.HighWaterMark = watermarkAfter;
        watermark.ScopeSignature = scopeSignature;
        watermark.LastRunStartedUtc = startedAtUtc;
        watermark.LastRunCompletedUtc = timeProvider.GetUtcNow();

        await dbContext.SaveChangesAsync(cancellationToken);

        return watermarkAfter;
    }

    private static async Task<Dictionary<string, TEntity>> LoadByExternalIdAsync<TEntity>(
        DbSet<TEntity> set,
        SourceId sourceId,
        IReadOnlyList<string> keys,
        Func<TEntity, string> externalIdOf,
        CancellationToken cancellationToken)
        where TEntity : class
    {
        Dictionary<string, TEntity> result = new(StringComparer.Ordinal);

        foreach (string[] chunk in keys.Chunk(LookupChunkSize))
        {
            List<TEntity> rows = await set
                .Where(BuildPredicate<TEntity>(sourceId, chunk))
                .ToListAsync(cancellationToken);

            foreach (TEntity row in rows)
            {
                result[externalIdOf(row)] = row;
            }
        }

        return result;
    }

    private static async Task<Dictionary<string, TId>> LoadIdMapAsync<TEntity, TId>(
        DbSet<TEntity> set,
        SourceId sourceId,
        IReadOnlyList<string> keys,
        Func<TEntity, string> externalIdOf,
        Func<TEntity, TId> idOf,
        CancellationToken cancellationToken)
        where TEntity : class
        where TId : notnull
    {
        Dictionary<string, TEntity> rows =
            await LoadByExternalIdAsync(set, sourceId, keys, externalIdOf, cancellationToken);

        return rows.ToDictionary(pair => pair.Key, pair => idOf(pair.Value), StringComparer.Ordinal);
    }

    private static System.Linq.Expressions.Expression<Func<TEntity, bool>> BuildPredicate<TEntity>(
        SourceId sourceId, string[] chunk)
        where TEntity : class
    {
        // Every entity this runs against exposes SourceId and ExternalId, but they share no base
        // type, so the filter is expressed through EF.Property rather than by introducing an
        // inheritance hierarchy purely to satisfy a generic constraint.
        return entity =>
            EF.Property<SourceId>(entity, nameof(SourceRecord.SourceId)) == sourceId &&
            chunk.Contains(EF.Property<string>(entity, nameof(SourceRecord.ExternalId)));
    }
}
