using Freshline.Core.Sources;

namespace Freshline.Core.Model;

/// <summary>
/// One row exactly as the source published it, retained verbatim and never rewritten.
///
/// This is the retention rule from ADR-0002 given a table: normalisation is lossy and
/// normalisation has bugs, so the payload that produced a canonical row is kept alongside it.
/// A mapping error is then fixed by re-normalising what is already stored, rather than by
/// re-fetching from every city and hoping the source has not moved on.
///
/// Rows are keyed by the source's natural key so that re-ingesting an overlapping window
/// updates the stored payload rather than accumulating copies of it.
/// </summary>
public class SourceRecord
{
    public long Id { get; set; }

    public required SourceId SourceId { get; set; }

    /// <summary>
    /// The natural key of the source row. For NYC this is
    /// <c>camis:inspection_date:inspection_type:violation_code</c> — verified unique across the
    /// full dataset once 140 groups of exact-duplicate rows are collapsed. See ADR-0003.
    /// </summary>
    public required string ExternalId { get; set; }

    public DateTimeOffset FetchedAtUtc { get; set; }

    /// <summary>The verbatim JSON object for this row, as returned by the source API.</summary>
    public required string Payload { get; set; }
}
