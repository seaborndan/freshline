namespace Freshline.Core.Queries;

/// <summary>
/// The values the filters will actually match, as they exist in the data right now.
///
/// <para><strong>Why this needs an endpoint at all.</strong> A client cannot discover these. The map
/// endpoint does not carry <c>Cuisine</c> — a pin is deliberately small — and the list endpoint
/// returns the cuisines of one page rather than the vocabulary. So a filter panel offering cuisines
/// has three options: ask, hard-code, or not exist. Hard-coding puts one city's source vocabulary in
/// a front end and drifts silently the first time ingestion meets a new one.</para>
///
/// <para><strong>Only the values a filter can match.</strong> Nulls are excluded because they are not
/// selectable: <c>?cuisine=</c> is an exact match against the empty string, which nothing has. This
/// matters more than it sounds, because null is not rare here — 3,605 establishments have no cuisine
/// and 66 have no locality, and none of them can be reached by any value in these lists. That is a
/// fact about the data and it belongs in the filter panel's design, not in a footnote.</para>
///
/// <para>Deliberately not counts. A count per cuisine would be a second, heavier query answering a
/// question nobody asked, and it would be wrong the moment a viewport or another filter narrowed the
/// set.</para>
/// </summary>
public sealed record EstablishmentFilterOptions
{
    /// <summary>
    /// Every distinct cuisine, ordered by name. 89 of them on 2026-07-26.
    ///
    /// <para>The source's own categories, unmapped — the same text the <c>cuisine</c> filter matches
    /// exactly. Nothing here translates or groups them; "Coffee/Tea" and "Café" are the source's
    /// distinction to make, not this system's.</para>
    /// </summary>
    public required IReadOnlyList<string> Cuisines { get; init; }

    /// <summary>
    /// Every distinct sub-city area, ordered by name. The five NYC boroughs today.
    ///
    /// <para>Queried rather than hard-coded even though "New York has five boroughs" is a fact that
    /// will not change, because <em>this list is not that fact</em> — it is the set of strings the
    /// source publishes, and the filter matches those strings exactly.</para>
    /// </summary>
    public required IReadOnlyList<string> Localities { get; init; }
}
