namespace Freshline.Core.Queries;

/// <summary>
/// A rectangle of the world, plus the filters to apply inside it.
///
/// <para><strong>Why a rectangle and not a spatial predicate.</strong> A map viewport genuinely is a
/// rectangle — it is the shape of the screen — and M3 measured that answering it with the spatial
/// index cost <strong>40,359</strong> logical reads against <strong>16,933</strong> for a bounding
/// box on the plain latitude and longitude columns. The spatial index exists for radius search,
/// which is a question a rectangle cannot ask. See ADR-0004 and docs/performance.md.</para>
///
/// <para><strong>Coordinate order is the trap this type is shaped to avoid.</strong> Latitude and
/// longitude are named, never positional. A NetTopologySuite <c>Point</c> takes (X, Y) — longitude
/// first — while T-SQL <c>geography::Point</c> takes latitude first, and swapping them throws
/// nothing while relocating every restaurant to the Southern Ocean. Named properties make the
/// mistake unwritable here.</para>
/// </summary>
public sealed record MapViewport
{
    public required double MinLatitude { get; init; }

    public required double MaxLatitude { get; init; }

    public required double MinLongitude { get; init; }

    public required double MaxLongitude { get; init; }

    public required EstablishmentFilter Filter { get; init; }

    /// <summary>The most rows to return. The caller's validated value; this type does not clamp.
    /// See <see cref="MapResult.IsTruncated"/> for what happens when the viewport holds more.</summary>
    public required int Limit { get; init; }
}

/// <summary>
/// Everything inside the viewport, up to the limit.
///
/// <para>Not paged, and that is deliberate. A cursor is for walking an ordered list to its end; a
/// map client does not walk, it pans — and when it pans it discards what it had and asks a new
/// question. Handing it a cursor would invite it to page through a viewport that stopped existing
/// the moment the user moved.</para>
/// </summary>
public sealed record MapResult
{
    public required IReadOnlyList<MapEstablishment> Items { get; init; }

    /// <summary>
    /// True when the viewport holds more establishments than <see cref="MapViewport.Limit"/>, so
    /// what came back is a subset.
    ///
    /// <para>Reported rather than hidden. A client that silently receives 1,000 of 4,000 pins draws
    /// a map that looks complete and is not — and the user has no way to tell. With this flag the
    /// client can say "zoom in to see everything", which is true and actionable.</para>
    ///
    /// <para>Which subset is arbitrary: the rows come back in primary-key order, which correlates
    /// with nothing a user cares about. It is stable rather than meaningful, and no client should
    /// read significance into a truncated set beyond "there are more".</para>
    /// </summary>
    public required bool IsTruncated { get; init; }
}

/// <summary>
/// One pin. Smaller than <see cref="EstablishmentSummary"/> because a map draws thousands of these
/// at once and every field is paid for on every pan.
/// </summary>
public sealed record MapEstablishment
{
    public required int Id { get; init; }

    public required string Name { get; init; }

    /// <summary>
    /// Never null, unlike everywhere else in this API. An establishment without coordinates cannot
    /// be drawn on a map, so the viewport query excludes it — 511 of 23,528 on 2026-07-26. Those
    /// rows are still reachable through the list and detail endpoints; they are absent here because
    /// this endpoint answers "what is on screen", and they are nowhere on screen.
    /// </summary>
    public required double Latitude { get; init; }

    /// <inheritdoc cref="Latitude"/>
    public required double Longitude { get; init; }

    /// <inheritdoc cref="EstablishmentDetail.IsAwaitingFirstInspection"/>
    public required bool IsAwaitingFirstInspection { get; init; }

    /// <summary>
    /// The most recent inspection, or <see langword="null"/> when there has never been one — which
    /// is the state a map most needs to show, and the one an inner join deletes.
    ///
    /// <para>The same type the list endpoint returns, so a client colours a pin and a row from the
    /// same fields. Consistency is worth more here than the few bytes a map-specific shape would
    /// save.</para>
    /// </summary>
    public LatestInspectionSummary? LatestInspection { get; init; }
}
