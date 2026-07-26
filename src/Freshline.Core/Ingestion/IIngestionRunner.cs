using Freshline.Core.Sources;

namespace Freshline.Core.Ingestion;

/// <summary>Runs one ingestion pass for one source and reports what it did.</summary>
public interface IIngestionRunner
{
    Task<IngestionRunResult> RunAsync(SourceId sourceId, CancellationToken cancellationToken);
}

/// <summary>
/// What a run actually changed.
///
/// The insert and update counts are split deliberately. "The row count did not change" is the
/// milestone's acceptance test, but it is a weaker statement than it looks: it would also hold
/// if a run inserted five rows and deleted five others. Reporting inserts separately lets a test
/// assert the stronger and more useful property — that a repeated window inserts <em>nothing</em>.
/// </summary>
public sealed record IngestionRunResult
{
    public required SourceId SourceId { get; init; }
    public required IngestionWindow Window { get; init; }

    /// <summary>Rows returned by the source, before deduplication.</summary>
    public required int RecordsFetched { get; init; }

    /// <summary>
    /// Rows remaining after collapsing duplicates on the natural key. NYC publishes 140 groups of
    /// exact duplicates city-wide, so this is normally lower than <see cref="RecordsFetched"/>.
    /// </summary>
    public required int RecordsDeduplicated { get; init; }

    public required int EstablishmentsInserted { get; init; }
    public required int EstablishmentsUpdated { get; init; }
    public required int InspectionsInserted { get; init; }
    public required int InspectionsUpdated { get; init; }
    public required int ViolationsInserted { get; init; }
    public required int ViolationsUpdated { get; init; }

    public DateOnly? WatermarkBefore { get; init; }
    public DateOnly? WatermarkAfter { get; init; }
}
