using Freshline.Core.Sources;

namespace Freshline.Core.Model;

/// <summary>
/// One visit to one establishment.
///
/// NYC publishes no inspection identifier, so <see cref="ExternalId"/> is derived by the
/// connector from <c>camis:inspection_date:inspection_type</c>. That derivation is a known
/// liability — re-worded inspection-type text would produce new ids — and is recorded as such
/// in ADR-0003 rather than hidden here.
/// </summary>
public class Inspection
{
    public int Id { get; set; }

    public required SourceId SourceId { get; set; }

    public required string ExternalId { get; set; }

    public int EstablishmentId { get; set; }

    public Establishment? Establishment { get; set; }

    public required DateOnly InspectedOn { get; set; }

    /// <summary>The source's own inspection-type text, retained unmapped.</summary>
    public string? InspectionType { get; set; }

    /// <summary>The source's own description of what the inspection resulted in.</summary>
    public string? Action { get; set; }

    /// <summary>
    /// The grade exactly as published, un-translated. NYC uses six values (A, B, C, N, Z, P)
    /// and leaves it null on more than half of all rows.
    /// </summary>
    public string? RawGrade { get; set; }

    /// <summary>The score exactly as published, un-translated and un-clamped.</summary>
    public int? RawScore { get; set; }

    /// <summary>The grade translated onto the cross-city scale.</summary>
    public InspectionOutcome Outcome { get; set; }

    /// <summary>
    /// Severity on a 0–100 scale where <strong>higher is worse</strong>, for cross-city
    /// comparison. Null when the source published no score.
    ///
    /// This is the highest-risk field in the system: a sign error here inverts the product's
    /// meaning while everything continues to run. The direction is asserted by
    /// <c>NycDohmhConnectorTests</c> against fixtures captured from real grade-A and grade-C
    /// responses, so an inversion fails the build rather than shipping quietly.
    /// </summary>
    public int? NormalisedSeverity { get; set; }

    /// <summary>True when the source recorded that the establishment was closed at this inspection.</summary>
    public bool ClosedByAuthority { get; set; }

    public DateTimeOffset FetchedAtUtc { get; set; }

    public long SourceRecordId { get; set; }

    public SourceRecord? SourceRecord { get; set; }

    public ICollection<Violation> Violations { get; set; } = [];
}
