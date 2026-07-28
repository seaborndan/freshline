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

    /// <summary>
    /// Where each of those areas is, so that choosing one can move the camera to it.
    ///
    /// <para><strong>Added alongside <see cref="Localities"/> rather than replacing it.</strong> The
    /// API's evolution rule is to add optional fields and never remove or repurpose one; turning a
    /// list of strings into a list of objects would break every client reading it today, including
    /// this project's own filter panel.</para>
    ///
    /// <para>An area with no drawable establishments has no entry here, so a locality can appear in
    /// <see cref="Localities"/> and not in this list. That is the honest shape: there is nowhere to
    /// point a camera at a set of establishments that have no coordinates.</para>
    /// </summary>
    public required IReadOnlyList<LocalityBounds> LocalityBounds { get; init; }
}

/// <summary>
/// The box containing every drawable establishment in one sub-city area.
///
/// <para><strong>Measured from the data, not taken from a published outline.</strong> Borough
/// outlines would be a second dataset to ingest and reconcile, and they answer a different question.
/// This box frames where the establishments <em>are</em>, which is what a camera should show when
/// somebody filters to a borough — a geographic outline of Queens includes a great deal of Queens
/// with no restaurants in it.</para>
///
/// <para><strong>What a single badly geocoded row would do.</strong> A minimum and a maximum are the
/// two statistics least robust to one bad value: a row geocoded into the Southern Ocean, of the kind
/// ADR-0004 describes as possible, would stretch this box across the Atlantic. Checked rather than
/// assumed — at the time of writing, zero establishments fall outside New York, zero sit at a zero
/// coordinate, and zero carry coordinates without a locality.</para>
///
/// <para>It is not defended against beyond that check, and the reason is that the defence already
/// exists somewhere better: the map refuses to move its camera outside the city at all
/// (<c>maxBounds</c>). So the worst a future bad row can do here is frame more of New York than it
/// should — visibly odd, and not a camera in the ocean.</para>
/// </summary>
public sealed record LocalityBounds
{
    public required string Locality { get; init; }

    public required double MinLatitude { get; init; }
    public required double MaxLatitude { get; init; }
    public required double MinLongitude { get; init; }
    public required double MaxLongitude { get; init; }
}
