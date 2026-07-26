using Freshline.Core.Ingestion;
using Freshline.Core.Sources;

namespace Freshline.Infrastructure.Tests;

/// <summary>
/// An <see cref="ISourceConnector"/> that replays a fixed set of records.
///
/// The idempotency test deliberately does not call the live NYC API. Two reasons: a test that
/// depends on a third party is a test that goes red for reasons unrelated to this code, and — more
/// to the point — the property under test is a property of the <em>upsert</em>, which needs the
/// input held still to be observed at all. The records replayed here are real captured responses
/// run through the real mapper, so nothing about the data is synthetic; only its delivery is.
///
/// The live end-to-end path is verified separately by running the worker against the real API,
/// and the numbers from that run are recorded in the M1 engineering log.
/// </summary>
internal sealed class ReplayConnector(
    SourceId sourceId,
    IReadOnlyList<CanonicalRecord> records,
    DateOnly backfillFloor,
    int lookbackDays = 30) : ISourceConnector
{
    /// <summary>How many times <see cref="FetchAsync"/> has been enumerated.</summary>
    internal int FetchCount { get; private set; }

    public SourceId SourceId => sourceId;

    public IngestionWindow GetWindow(DateOnly? watermark)
        => IngestionWindow.FromWatermark(watermark, backfillFloor, lookbackDays);

    public async IAsyncEnumerable<CanonicalRecord> FetchAsync(
        IngestionWindow window,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        FetchCount++;

        foreach (CanonicalRecord record in records)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return record;
        }

        await Task.CompletedTask;
    }
}
