namespace Freshline.Core.Ingestion;

/// <summary>
/// The slice of a source's history a single run will ask for.
///
/// The interesting part is <see cref="FromWatermark"/>. A plain watermark — "fetch everything
/// after the newest row I hold" — is correct only for append-only sources. NYC restates rows in
/// place: an inspection published in March can be corrected in July without its inspection date
/// moving, so it stays permanently below the watermark and is never seen again.
///
/// The fix is a <em>lookback window</em>: start the request some days <em>before</em> the
/// watermark and deliberately re-read data already held. That overlap is what makes the upsert
/// load-bearing rather than defensive — every run re-fetches rows it already has, so an upsert
/// bug shows up as growth on every run instead of on an unlucky one.
/// </summary>
public sealed record IngestionWindow
{
    public required DateOnly From { get; init; }

    /// <summary>Null means "up to whatever the source has", which is the normal case.</summary>
    public DateOnly? To { get; init; }

    /// <summary>
    /// Builds the window for the next run.
    /// </summary>
    /// <param name="watermark">Highest date already ingested, or null before the first run.</param>
    /// <param name="backfillFloor">
    /// The earliest date this deployment will ever ask for. It bounds the first run, and it also
    /// stops the lookback from walking backwards past the intended scope on later runs.
    /// </param>
    /// <param name="lookbackDays">How far before the watermark to re-read. Must not be negative.</param>
    public static IngestionWindow FromWatermark(DateOnly? watermark, DateOnly backfillFloor, int lookbackDays)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(lookbackDays);

        if (watermark is null)
        {
            return new IngestionWindow { From = backfillFloor };
        }

        DateOnly withLookback = watermark.Value.AddDays(-lookbackDays);
        return new IngestionWindow { From = withLookback < backfillFloor ? backfillFloor : withLookback };
    }
}
