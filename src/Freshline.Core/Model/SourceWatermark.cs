using Freshline.Core.Sources;

namespace Freshline.Core.Model;

/// <summary>
/// How far through a source's history ingestion has reached.
///
/// A <em>watermark</em> is the highest value of some ordered field already ingested; the next
/// run asks the source only for rows above it, so work is proportional to what changed rather
/// than to the size of the dataset. It is the same idea as a <c>rowversion</c> used for
/// concurrency, pointed outward at a remote source instead of inward at a table.
///
/// NYC forces a wrinkle. Its only timestamp that looks like a change-tracking field,
/// <c>record_date</c>, holds three distinct values across all 295,294 rows — it stamps the
/// portal's whole-dataset extract, not the row. So the watermark runs on the event date, and
/// re-reading is handled by a lookback window on top of it rather than by the watermark alone.
/// See ADR-0003.
/// </summary>
public class SourceWatermark
{
    /// <summary>Primary key. One row per source.</summary>
    public required SourceId SourceId { get; set; }

    /// <summary>
    /// The highest inspection date ingested so far. Null before the first successful run,
    /// which is what makes the first run a backfill from the configured floor.
    /// </summary>
    public DateOnly? HighWaterMark { get; set; }

    public DateTimeOffset? LastRunStartedUtc { get; set; }

    public DateTimeOffset? LastRunCompletedUtc { get; set; }
}
