using Freshline.Core.Sources;

namespace Freshline.Core.Ingestion;

/// <summary>
/// Fetches one city's records and translates them into canonical terms.
///
/// This is the interface ADR-0002 is about: adding a city is an implementation of this and its
/// tests, not a change to the pipeline. Implementations live in Infrastructure because they need
/// HTTP; the contract lives here because Core defines what the outer layers implement.
///
/// Results are streamed rather than returned as a list so that a source with more rows than fit
/// comfortably in memory is a paging concern inside the connector rather than a redesign.
/// </summary>
public interface ISourceConnector
{
    SourceId SourceId { get; }

    /// <summary>
    /// Decides what to ask for, given how far ingestion has previously reached.
    ///
    /// This lives on the connector rather than on the runner because the answer is a property of
    /// the source: how far back it restates records, and how far back this deployment cares. A
    /// runner that owned this would need editing every time a city was added, which is exactly
    /// the coupling ADR-0002 exists to avoid.
    /// </summary>
    IngestionWindow GetWindow(DateOnly? watermark);

    IAsyncEnumerable<CanonicalRecord> FetchAsync(IngestionWindow window, CancellationToken cancellationToken);
}
