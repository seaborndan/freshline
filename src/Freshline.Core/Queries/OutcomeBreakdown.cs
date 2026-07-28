using Freshline.Core.Model;
using Freshline.Core.Reporting;

namespace Freshline.Core.Queries;

/// <summary>What an outcome breakdown groups by. The report's one structural choice.</summary>
public enum ReportDimension
{
    /// <summary>Sub-city area — borough, in NYC. Five values.</summary>
    Locality = 0,

    /// <summary>
    /// The source's own cuisine description. 89 values, and <strong>uncurated</strong>: they are the
    /// categories the city assigns, not a taxonomy this project designed or validated.
    /// </summary>
    Cuisine = 1,
}

/// <summary>
/// The question an outcome breakdown answers: how do inspection results distribute across boroughs,
/// or across cuisines?
/// </summary>
public sealed record OutcomeBreakdownQuery
{
    public required ReportDimension Dimension { get; init; }

    /// <summary>Restrict to one borough. Null means every borough.</summary>
    public string? Locality { get; init; }

    /// <summary>Restrict to one cuisine. Null means every cuisine.</summary>
    public string? Cuisine { get; init; }

    /// <summary>
    /// Only count inspections on or after this date. Null means no lower bound.
    ///
    /// <para><strong>A date range changes what "latest" means, and that is the point.</strong> With
    /// no range, an establishment's outcome is its most recent inspection ever. With one, it is its
    /// most recent inspection <em>inside the range</em> — which is what makes "how did 2025 look"
    /// answerable at all. The alternative reading, filtering establishments by whether their
    /// all-time latest inspection falls in the range, answers a question nobody asks.</para>
    /// </summary>
    public DateOnly? InspectedFrom { get; init; }

    /// <summary>Only count inspections on or before this date. Null means no upper bound.</summary>
    public DateOnly? InspectedTo { get; init; }

    /// <summary>True when a date range narrows which inspections count.</summary>
    public bool HasDateRange => InspectedFrom is not null || InspectedTo is not null;
}

/// <summary>
/// One group's row — a borough or a cuisine, and how its establishments' results distribute.
///
/// <para><strong>Counts of establishments, not of inspections.</strong> Each establishment
/// contributes exactly one outcome: its latest counted inspection. Counting inspections instead
/// would weight an establishment inspected six times six times as heavily as one inspected once,
/// which measures inspection frequency while appearing to measure results.</para>
/// </summary>
public sealed record OutcomeBreakdownRow
{
    /// <summary>The borough or cuisine this row describes.</summary>
    public required string Group { get; init; }

    /// <summary>Every establishment in the group, including those with no counted outcome.</summary>
    public required int Total { get; init; }

    /// <summary>
    /// Establishments the city lists and has never inspected at all.
    ///
    /// <para>A published state rather than an absence in our records, and 3,605 of 23,528 city-wide.
    /// Reported separately from <see cref="NoInspectionInPeriod"/> because the two are different
    /// facts that a single "no data" column would merge.</para>
    /// </summary>
    public required int NeverInspected { get; init; }

    /// <summary>
    /// Establishments with no counted outcome that are not awaiting a first inspection — in other
    /// words, inspected at some point, but not within the selected date range.
    ///
    /// <para>Kept as its own column even when no range is selected, so the shape of the table does
    /// not change with the filters. A column that appears and disappears is harder to read than one
    /// that reads zero.</para>
    ///
    /// <para><strong>With no date range this should be zero, and a non-zero value is worth
    /// noticing.</strong> It would mean an establishment has no inspections at all while the source's
    /// own <c>IsAwaitingFirstInspection</c> flag says otherwise — the two facts disagreeing. Verified
    /// against the live data, where there are <strong>zero</strong> such rows, so the invariant holds
    /// today. It is not asserted here: this column surfacing the disagreement is more useful than a
    /// query that hides it by construction, and the API tests' fixture deliberately contains such a
    /// row.</para>
    /// </summary>
    public required int NoInspectionInPeriod { get; init; }

    public required int Good { get; init; }
    public required int Fair { get; init; }
    public required int Poor { get; init; }
    public required int Ungraded { get; init; }
    public required int PendingReinspection { get; init; }

    /// <summary>
    /// Establishments with a counted outcome — the denominator for every rate on this row.
    ///
    /// <para><strong>Not <see cref="Total"/>.</strong> Including establishments with no outcome would
    /// dilute every rate by however thoroughly the city has inspected that group, so a borough with a
    /// large inspection backlog would appear to have better results than one that has been visited.
    /// That is a statement about enforcement dressed up as a statement about hygiene.</para>
    /// </summary>
    public int Inspected => Good + Fair + Poor + Ungraded + PendingReinspection;

    /// <summary>
    /// The share of inspected establishments whose latest counted result was <c>Poor</c>, and what
    /// the evidence supports.
    ///
    /// <para>See ADR-0007: <see cref="ProportionEstimate.Observed"/> is what a table displays, and
    /// <see cref="ProportionEstimate.SupportedAtLeast"/> is what it sorts by — so a cuisine with two
    /// establishments and one poor result does not outrank one with four hundred.</para>
    /// </summary>
    public ProportionEstimate PoorShare => new() { Count = Poor, Total = Inspected };
}

/// <summary>
/// A whole breakdown, and the facts a reader needs in order to know what it does not cover.
/// </summary>
public sealed record OutcomeBreakdown
{
    public required ReportDimension Dimension { get; init; }

    /// <summary>
    /// The rows, ordered by what the evidence supports rather than by observed rate — worst first.
    ///
    /// <para>The default order is the defensible one. A user who explicitly sorts by the displayed
    /// percentage gets the naive order, because a column header that does not do what it says would
    /// be an interface lying about itself.</para>
    /// </summary>
    public required IReadOnlyList<OutcomeBreakdownRow> Rows { get; init; }

    /// <summary>
    /// Establishments excluded from every row because the grouping column is null for them.
    ///
    /// <para>Reported rather than silently dropped. Null is not rare here: 3,605 establishments have
    /// no cuisine — exactly those never inspected — and 66 have no locality. A table whose totals do
    /// not reconcile with the dataset summary, with nothing explaining the gap, is a table a reader
    /// is right to distrust.</para>
    /// </summary>
    public required int UngroupedEstablishments { get; init; }

    /// <summary>True when a date range narrowed which inspections were counted.</summary>
    public required bool HasDateRange { get; init; }
}
