using Freshline.Core.Model;

namespace Freshline.Core.Queries;

/// <summary>
/// One establishment with its inspection history, shaped for the detail screen.
///
/// <para>This is a <em>read model</em>, not an entity. <see cref="Establishment"/> is never
/// serialised, for three reasons that are worth being able to state separately: navigation
/// properties give the serialiser cycles to fall into; the entity carries fields no caller should
/// see (<c>SourceRecordId</c>, the raw payload it came from); and returning it would make the
/// storage schema the public contract, so a column rename becomes a breaking API change.</para>
///
/// <para>The types in this namespace exist only to be the result of a query. They are defined in
/// Core because the query interface that returns them is defined in Core — see
/// <see cref="IEstablishmentQueries"/> for why that interface lives here rather than in
/// Infrastructure.</para>
/// </summary>
public sealed record EstablishmentDetail
{
    public required int Id { get; init; }

    public required string Name { get; init; }

    /// <summary>As the source categorises it, unmapped. Null for every establishment that has never
    /// been inspected — NYC publishes no cuisine on those rows.</summary>
    public string? Cuisine { get; init; }

    public string? Phone { get; init; }

    public string? AddressLine { get; init; }

    /// <summary>The sub-city area — borough, in NYC. Named for the canonical model rather than for
    /// one city's vocabulary, so nothing downstream learns NYC's words for things.</summary>
    public string? Locality { get; init; }

    public string? PostalCode { get; init; }

    /// <summary>
    /// Latitude and longitude as the source published them. Null together or present together —
    /// never one without the other.
    ///
    /// <para>The stored <c>geography</c> point is deliberately <em>not</em> exposed. It says the
    /// same thing as these two fields (ADR-0004), it has no useful JSON representation, and a map
    /// client wants two numbers. Nothing is lost by leaving it in the database.</para>
    /// </summary>
    public double? Latitude { get; init; }

    /// <inheritdoc cref="Latitude"/>
    public double? Longitude { get; init; }

    /// <summary>
    /// True when the source publishes this establishment but has recorded no inspection for it.
    /// <see cref="Inspections"/> is empty in that case.
    ///
    /// <para>This is a real state, not missing data: NYC encodes it as a sentinel inspection dated
    /// 1900-01-01, and it is the "newly permitted, no history" signal the product is partly built
    /// on. See ADR-0003.</para>
    /// </summary>
    public required bool IsAwaitingFirstInspection { get; init; }

    /// <summary>Newest first. Empty when the establishment has never been inspected.</summary>
    public required IReadOnlyList<InspectionDetail> Inspections { get; init; }
}

/// <summary>One visit, with everything cited during it.</summary>
public sealed record InspectionDetail
{
    public required int Id { get; init; }

    public required DateOnly InspectedOn { get; init; }

    /// <summary>The source's own inspection-type text, unmapped.</summary>
    public string? InspectionType { get; init; }

    /// <summary>The source's own description of what the inspection resulted in.</summary>
    public string? Action { get; init; }

    /// <summary>
    /// The grade exactly as published: one of A, B, C, N, Z, P — or null, which is the case on a
    /// large share of inspections and is not an error. Six values, not three (ADR-0003).
    /// </summary>
    public string? RawGrade { get; init; }

    /// <summary>The score exactly as published, un-clamped. Observed values run past 100.</summary>
    public int? RawScore { get; init; }

    /// <summary>
    /// The grade translated onto the cross-source scale. Never derived from
    /// <see cref="RawScore"/> — the score ranges overlap badly enough that no threshold
    /// reproduces the published grade.
    /// </summary>
    public required InspectionOutcome Outcome { get; init; }

    /// <summary>
    /// 0–100, <strong>higher is worse</strong>. Null when the source published no score.
    ///
    /// <para>Both the raw and the normalised values are on the wire on purpose. The raw grade is
    /// what a user recognises — it is the letter in the restaurant's window — while the normalised
    /// severity is what a client sorts and colours by without needing to know one city's grading
    /// direction.</para>
    /// </summary>
    public int? NormalisedSeverity { get; init; }

    /// <summary>True when the source recorded the establishment as closed at this inspection.</summary>
    public required bool ClosedByAuthority { get; init; }

    /// <summary>
    /// Ordered by <see cref="ViolationDetail.Code"/>, which is unique within an inspection —
    /// verified against the database rather than inferred from the natural key.
    /// </summary>
    public required IReadOnlyList<ViolationDetail> Violations { get; init; }
}

/// <summary>A single cited violation.</summary>
public sealed record ViolationDetail
{
    /// <summary>
    /// The source's own code, e.g. NYC <c>04L</c> for evidence of mice. This is the field to
    /// filter and group on. <see cref="Description"/> is prose and searching it returns confident
    /// nonsense — NYC never writes "vermin", so a keyword search for it returns zero.
    /// </summary>
    public required string Code { get; init; }

    public string? Description { get; init; }

    /// <summary>
    /// Whether the source flagged this as critical. Null when the source published
    /// "Not Applicable", which is a genuine third state rather than a missing value — flattening
    /// it to false would assert something the source never said.
    /// </summary>
    public bool? IsCritical { get; init; }
}
