namespace Freshline.Core.Queries;

/// <summary>
/// The read path over establishments.
///
/// <para><strong>Why this interface is in Core.</strong> The dependency direction in this repository
/// is one-way — Api and Ingestion depend on Infrastructure, Infrastructure depends on Core, and
/// nothing depends outwards. `CLAUDE.md` names the specific thing that layout exists to prevent:
/// "just this once, the API will query the DbContext directly". M4 is exactly where that shortcut
/// gets tempting, because every endpoint here is a query.</para>
///
/// <para>Declaring the contract in Core and implementing it in Infrastructure means the API can
/// state what it needs without being able to reach a <c>DbContext</c> to get it. That is enforced
/// by a test rather than by this comment: <c>ArchitectureTests</c> asserts the compiled API
/// assembly holds no reference to Entity Framework at all.</para>
///
/// <para>This is a query interface for the read path, not a generic repository. There is no
/// <c>IRepository&lt;Establishment&gt;</c> here, because wrapping <c>DbSet</c> in a thinner
/// <c>DbSet</c> buys nothing — the reason for the seam is the dependency direction, not an
/// ambition to swap out the database.</para>
/// </summary>
public interface IEstablishmentQueries
{
    /// <summary>
    /// Returns the establishment with this id together with its inspection history, or
    /// <see langword="null"/> when there is no such establishment.
    ///
    /// <para>Null rather than an exception: "there isn't one" is an ordinary answer to this
    /// question, not a failure. The HTTP layer is what decides that a missing establishment is a
    /// 404, because status codes are a transport concern and this interface has no opinion about
    /// transport.</para>
    /// </summary>
    Task<EstablishmentDetail?> GetAsync(int id, CancellationToken cancellationToken);

    /// <summary>
    /// Returns one page of establishments matching <paramref name="query"/>, ordered by name and
    /// then by id.
    ///
    /// <para>The ordering is part of the contract rather than an implementation detail, because
    /// keyset pagination only works if the sort is total and stable: the cursor is a position in
    /// <em>this</em> order, and changing the order silently invalidates every cursor a client
    /// holds.</para>
    /// </summary>
    Task<EstablishmentPage> ListAsync(EstablishmentListQuery query, CancellationToken cancellationToken);

    /// <summary>
    /// Returns the establishments inside <paramref name="viewport"/> that have coordinates, up to
    /// the viewport's limit.
    ///
    /// <para>Unpaged by design — see <see cref="MapResult"/>. Establishments with no coordinates are
    /// excluded; establishments with no inspections are not.</para>
    /// </summary>
    Task<MapResult> MapAsync(MapViewport viewport, CancellationToken cancellationToken);

    /// <summary>
    /// Returns the distinct values the <c>cuisine</c> and <c>locality</c> filters can match.
    ///
    /// <para>Unfiltered and un-scoped on purpose: these are the values that exist in the data, not
    /// the ones that would return something inside the caller's current viewport. Narrowing them to
    /// a viewport would make the filter panel's options change as the user pans, which reads as
    /// options disappearing rather than as a smaller map.</para>
    /// </summary>
    Task<EstablishmentFilterOptions> GetFilterOptionsAsync(CancellationToken cancellationToken);
}
