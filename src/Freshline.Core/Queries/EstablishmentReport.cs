using Freshline.Core.Model;

namespace Freshline.Core.Queries;

/// <summary>
/// The question this answers: <em>which establishments</em>, rather than how results distribute
/// across groups.
///
/// <para><strong>Why this is not the existing list endpoint.</strong> <c>/establishments</c> is
/// cursor-paged, and a cursor is a position in one particular order — name. That is right for
/// walking the whole dataset and wrong for a report table, where the useful orders are "worst result
/// first" and "most recently inspected". It also carries no date range, because narrowing a list by
/// inspection date would change what its <c>outcome</c> filter means.</para>
///
/// <para><strong>Why a cap and not paging.</strong> Offset paging would allow arbitrary server-side
/// sorting and was measured in M3 to degrade with depth: 307 logical reads at page 461 against 9 for
/// keyset. Returning a bounded set and sorting it in the client is the same trade the map already
/// makes, and it keeps every column sortable.</para>
/// </summary>
public sealed record EstablishmentReportQuery
{
    public string? Locality { get; init; }
    public string? Cuisine { get; init; }

    /// <summary>Match on the latest counted inspection's outcome. Null means any.</summary>
    public InspectionOutcome? Outcome { get; init; }

    /// <summary>
    /// True for only never-inspected establishments, false to exclude them, null for both.
    ///
    /// <para>Combining <c>true</c> with an <see cref="Outcome"/> is a guaranteed empty result rather
    /// than a narrower one: an establishment with no inspections has no outcome to match. That is the
    /// caller's contradiction to make, and it is answered honestly with zero rows.</para>
    /// </summary>
    public bool? IsAwaitingFirstInspection { get; init; }

    /// <summary>
    /// Only count inspections on or after this date. Null means no lower bound.
    ///
    /// <para>Same semantics as the outcome breakdown: the range narrows <em>which inspections
    /// count</em>, so an establishment's reported result is its latest inspection within the period.
    /// Establishments with no inspection in the period are still listed, with a null result — they
    /// are part of the answer to "what is in this borough", and dropping them would quietly turn a
    /// list of establishments into a list of inspections.</para>
    /// </summary>
    public DateOnly? InspectedFrom { get; init; }

    /// <summary>Only count inspections on or before this date. Null means no upper bound.</summary>
    public DateOnly? InspectedTo { get; init; }

    /// <summary>How many rows to return at most. The caller is told when this bit.</summary>
    public required int Limit { get; init; }
}

/// <summary>One establishment, as a row in a report.</summary>
public sealed record EstablishmentReportRow
{
    public required int Id { get; init; }
    public required string Name { get; init; }

    public string? AddressLine { get; init; }
    public string? Locality { get; init; }
    public string? Cuisine { get; init; }

    /// <summary>
    /// True when the city lists this establishment and has never inspected it.
    ///
    /// <para>Distinct from having no result <em>in the selected period</em>, which is an
    /// establishment with inspections that fall outside it. Both produce a null
    /// <see cref="Outcome"/>, and a reader needs to be able to tell them apart.</para>
    /// </summary>
    public required bool IsAwaitingFirstInspection { get; init; }

    /// <summary>The latest counted inspection's outcome, or null when there is no counted one.</summary>
    public InspectionOutcome? Outcome { get; init; }

    /// <summary>The date of that inspection. Null exactly when <see cref="Outcome"/> is.</summary>
    public DateOnly? InspectedOn { get; init; }

    /// <summary>The letter the city issued, which is what a person recognises from the window.</summary>
    public string? RawGrade { get; init; }

    public int? RawScore { get; init; }

    /// <summary>
    /// Whether the authority closed the establishment at that inspection.
    ///
    /// <para>A separate fact from the result, not a worse grade — an establishment can be closed at
    /// an inspection that produced no letter at all.</para>
    /// </summary>
    public required bool ClosedByAuthority { get; init; }
}

/// <summary>A page of establishments, and whether it is the whole answer.</summary>
public sealed record EstablishmentReport
{
    public required IReadOnlyList<EstablishmentReportRow> Rows { get; init; }

    /// <summary>
    /// True when more establishments matched than were returned.
    ///
    /// <para>Which rows were dropped is arbitrary — they are whatever the ordering reached first —
    /// so nothing derived from a truncated result may be stated as a fact about the whole set.
    /// ADR-0007 decision 4, and the same rule the map's <c>isTruncated</c> enforces.</para>
    /// </summary>
    public required bool IsTruncated { get; init; }

    /// <summary>True when a date range narrowed which inspections counted.</summary>
    public required bool HasDateRange { get; init; }
}
