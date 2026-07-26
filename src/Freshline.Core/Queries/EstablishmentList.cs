using Freshline.Core.Model;

namespace Freshline.Core.Queries;

/// <summary>
/// What to select for a page of the establishment list. Filters are combined with AND; every one of
/// them is optional, and an all-null query means "everything, first page".
///
/// <para>This is deliberately not an <c>IQueryable</c> handed out of Infrastructure. Letting the API
/// compose its own query would make every EF limitation an API bug and would put the storage schema
/// back in the caller's hands — the specific coupling the layering exists to prevent. The set of
/// questions this endpoint can ask is finite, so it is written down.</para>
/// </summary>
public sealed record EstablishmentListQuery
{
    /// <summary>Matched against the start of the name, case-insensitively — the database collation
    /// decides, not the application. A prefix rather than a contains-search because a leading
    /// wildcard cannot use an index; see the note on <see cref="EstablishmentCursor"/>.</summary>
    public string? NameStartsWith { get; init; }

    /// <summary>Exact match on the source's own cuisine text. 89 distinct values in the data as
    /// ingested on 2026-07-26.</summary>
    public string? Cuisine { get; init; }

    /// <summary>Exact match on the sub-city area — borough, in NYC.</summary>
    public string? Locality { get; init; }

    /// <summary>
    /// Matched against the outcome of the establishment's <em>most recent</em> inspection.
    ///
    /// <para>The normalised outcome rather than the raw letter, on purpose. Filtering on <c>"A"</c>
    /// would put one city's vocabulary in the public contract, and this is the same reason
    /// <c>Locality</c> is not called <c>Borough</c>. An establishment that has never been inspected
    /// matches no outcome and is excluded whenever this is set.</para>
    /// </summary>
    public InspectionOutcome? Outcome { get; init; }

    /// <summary>
    /// When true, only establishments holding a permit with no inspection history. When false, only
    /// those that have been inspected. Null does not filter.
    ///
    /// <para>This is the greenfield signal M6's scoring is built on, so it is a first-class filter
    /// rather than something a caller has to infer from an empty inspection list.</para>
    /// </summary>
    public bool? IsAwaitingFirstInspection { get; init; }

    /// <summary>Where to resume from. Null starts at the beginning.</summary>
    public EstablishmentCursor? After { get; init; }

    /// <summary>How many rows to return. The caller's validated value — this type does not clamp,
    /// because a silently adjusted page size is worse than a rejected request.</summary>
    public required int PageSize { get; init; }
}

/// <summary>
/// A position in the ordered list: the sort key of the last row a caller was given.
///
/// <para><strong>Why two fields.</strong> The list is ordered by name, and names are not unique —
/// 1,507 name groups in the ingested data hold more than one establishment, 6,546 establishments
/// share a name, and <c>DUNKIN</c> alone appears 307 times. A cursor holding only the name would
/// resume at "the next row after some DUNKIN", and the database is free to pick a different one each
/// time, so a caller paging through would skip or repeat whole blocks of a chain. The primary key is
/// appended as a tiebreaker to make the ordering total; without it, keyset pagination is not correct,
/// it merely usually works.</para>
///
/// <para>The API encodes this as an opaque string. That is a transport decision and lives in the API
/// layer, not here — this type is the meaning, not the wire format.</para>
/// </summary>
public sealed record EstablishmentCursor(string Name, int Id);

/// <summary>
/// One page of results, and where the next one starts.
///
/// <para>No total count. Counting the matching rows means a second query that reads the whole
/// filtered set on every page request, which costs more than the page itself and is the thing keyset
/// pagination is chosen to avoid. If a total is ever genuinely needed it should arrive as its own
/// endpoint that a caller opts in to, not as a tax on every page.</para>
/// </summary>
public sealed record EstablishmentPage
{
    public required IReadOnlyList<EstablishmentSummary> Items { get; init; }

    /// <summary>The sort key to resume from, or null when this is the last page. Derived from
    /// whether another row exists, not guessed from whether the page came back full.</summary>
    public EstablishmentCursor? Next { get; init; }
}

/// <summary>
/// One row of the list. Smaller than <see cref="EstablishmentDetail"/> on purpose: a list of 50
/// establishments with full inspection history would be a large response nobody asked for, and the
/// detail endpoint already exists for the one the caller picks.
/// </summary>
public sealed record EstablishmentSummary
{
    public required int Id { get; init; }

    public required string Name { get; init; }

    public string? Cuisine { get; init; }

    public string? Locality { get; init; }

    /// <summary>Null together or present together, as on the detail model.</summary>
    public double? Latitude { get; init; }

    /// <inheritdoc cref="Latitude"/>
    public double? Longitude { get; init; }

    /// <inheritdoc cref="EstablishmentDetail.IsAwaitingFirstInspection"/>
    public required bool IsAwaitingFirstInspection { get; init; }

    /// <summary>
    /// The most recent inspection, or <see langword="null"/> when there has never been one.
    ///
    /// <para>Nullable rather than flattened into this record, because "never inspected" and "graded
    /// null at the last inspection" are different facts and a client colouring a map has to tell
    /// them apart. It is also the join semantics made visible: this is a left join, and an
    /// establishment with no inspection stays in the list.</para>
    /// </summary>
    public LatestInspectionSummary? LatestInspection { get; init; }
}

/// <summary>Just enough of the most recent inspection to render a list row or a map pin.</summary>
public sealed record LatestInspectionSummary
{
    public required DateOnly InspectedOn { get; init; }

    /// <inheritdoc cref="InspectionDetail.RawGrade"/>
    public string? RawGrade { get; init; }

    /// <inheritdoc cref="InspectionDetail.Outcome"/>
    public required InspectionOutcome Outcome { get; init; }

    /// <inheritdoc cref="InspectionDetail.NormalisedSeverity"/>
    public int? NormalisedSeverity { get; init; }

    public required bool ClosedByAuthority { get; init; }
}
