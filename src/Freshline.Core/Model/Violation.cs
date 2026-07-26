using Freshline.Core.Sources;

namespace Freshline.Core.Model;

/// <summary>
/// A single cited violation within an inspection.
///
/// <see cref="Code"/> is the field to filter and group on, never <see cref="Description"/>.
/// The description is prose: NYC writes "Establishment is not free of harborage or conditions
/// conducive to rodents, insects or other pests" and never once uses the word "vermin", so a
/// keyword search against it returns a confident zero that means nothing. The code is stable
/// within a source.
/// </summary>
public class Violation
{
    public int Id { get; set; }

    public required SourceId SourceId { get; set; }

    public required string ExternalId { get; set; }

    public int InspectionId { get; set; }

    public Inspection? Inspection { get; set; }

    /// <summary>The source's own violation code, e.g. NYC <c>04L</c> for evidence of mice.</summary>
    public required string Code { get; set; }

    public string? Description { get; set; }

    /// <summary>
    /// Whether the source flagged this violation as critical. Null when the source published
    /// "Not Applicable" rather than a yes or no — which is a third state, not a missing value.
    /// </summary>
    public bool? IsCritical { get; set; }

    public DateTimeOffset FetchedAtUtc { get; set; }

    public long SourceRecordId { get; set; }

    public SourceRecord? SourceRecord { get; set; }
}
