using Freshline.Core.Model;
using Freshline.Core.Sources;

namespace Freshline.Core.Ingestion;

/// <summary>
/// One source row, already translated into canonical terms but not yet written anywhere.
///
/// This type is the seam between the two halves of ingestion. A connector's whole job is to
/// turn its city's rows into these; the writer's whole job is to turn these into a graph of
/// entities and upsert it. Keeping the seam flat — one record per source row, mirroring the
/// source's own grain — means a connector can be tested against captured API responses with
/// no database anywhere in the test, which is what makes the normalisation tests cheap enough
/// to be thorough.
/// </summary>
public sealed record CanonicalRecord
{
    public required SourceId SourceId { get; init; }

    /// <summary>The source row's natural key, used to deduplicate and to key the retained payload.</summary>
    public required string ExternalId { get; init; }

    /// <summary>The verbatim JSON for this row.</summary>
    public required string RawPayload { get; init; }

    public required DateTimeOffset FetchedAtUtc { get; init; }

    public required CanonicalEstablishment Establishment { get; init; }

    /// <summary>Null when the row records an establishment that has never been inspected.</summary>
    public CanonicalInspection? Inspection { get; init; }

    /// <summary>Null when the inspection cited no violation, which is a real and common case.</summary>
    public CanonicalViolation? Violation { get; init; }
}

public sealed record CanonicalEstablishment
{
    public required string ExternalId { get; init; }
    public required string Name { get; init; }
    public string? Cuisine { get; init; }
    public string? Phone { get; init; }
    public string? AddressLine { get; init; }
    public string? Locality { get; init; }
    public string? PostalCode { get; init; }
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public bool IsAwaitingFirstInspection { get; init; }
}

public sealed record CanonicalInspection
{
    public required string ExternalId { get; init; }
    public required DateOnly InspectedOn { get; init; }
    public string? InspectionType { get; init; }
    public string? Action { get; init; }
    public string? RawGrade { get; init; }
    public int? RawScore { get; init; }
    public required InspectionOutcome Outcome { get; init; }

    /// <summary>0–100, higher is worse. See <see cref="Model.Inspection.NormalisedSeverity"/>.</summary>
    public int? NormalisedSeverity { get; init; }

    public bool ClosedByAuthority { get; init; }
}

public sealed record CanonicalViolation
{
    public required string ExternalId { get; init; }
    public required string Code { get; init; }
    public string? Description { get; init; }
    public bool? IsCritical { get; init; }
}
