using Freshline.Core.Model;
using Freshline.Core.Queries;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Freshline.Api.Endpoints;

/// <summary>
/// A page of establishments as it goes over the wire.
///
/// <para>Distinct from <see cref="EstablishmentPage"/> because the two differ in exactly one place
/// that matters: the query returns the next position as a typed <see cref="EstablishmentCursor"/>,
/// and the wire carries it as an opaque string. Reusing the query type would either leak the sort
/// key into the public contract or need the encoding done in Core, and neither belongs there.</para>
/// </summary>
public sealed record EstablishmentListResponse
{
    public required IReadOnlyList<EstablishmentSummary> Items { get; init; }

    /// <summary>
    /// Pass this back as <c>cursor</c> to get the next page. Null means this was the last page.
    ///
    /// <para>Null is the only end-of-list signal. There is no total count and no page number, so a
    /// caller pages until this is null rather than computing how many pages there are.</para>
    /// </summary>
    public string? NextCursor { get; init; }
}

/// <summary>
/// HTTP over the establishment read path. Routing, status codes and error shape only — every
/// question about the data is asked through <see cref="IEstablishmentQueries"/>.
/// </summary>
internal static class EstablishmentEndpoints
{
    public static RouteGroupBuilder MapEstablishmentEndpoints(this RouteGroupBuilder api)
    {
        RouteGroupBuilder establishments = api
            .MapGroup("/establishments")
            .WithTags("Establishments")

            // Declared on the group because it is true of the group: every endpoint here is behind
            // the same rate-limit bucket. A 429 that only appears under load is precisely the
            // response a client author will not have handled unless the document told them it
            // existed.
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        establishments
            .MapGet("/", ListAsync)
            .WithName("ListEstablishments")
            .WithSummary("List establishments, filtered, one page at a time")
            .WithDescription(
                "Ordered by name. Paging is by cursor: send the nextCursor from the previous " +
                "response as `cursor`. A null nextCursor means there are no more results. " +
                "Establishments that have never been inspected are included, with a null " +
                "latestInspection — filter them in or out with `awaitingFirstInspection`.")
            .ProducesProblem(StatusCodes.Status400BadRequest);

        // Before "/{id:int}", though routing scores literal segments above constrained parameters
        // regardless of order, so /establishments/map cannot be shadowed. Ordered this way for a
        // reader, not for the router.
        establishments
            .MapGet("/map", MapAsync)
            .WithName("MapEstablishments")
            .WithSummary("Everything inside a map viewport")
            .WithDescription(
                "A bounding box, not a radius. All four bounds are required. Establishments with " +
                "no coordinates are excluded because they cannot be drawn; establishments with no " +
                "inspections are included, with a null latestInspection. Not paged — if the " +
                "viewport holds more than `limit`, isTruncated is true and the client should zoom " +
                "in rather than try to page.")
            .ProducesProblem(StatusCodes.Status400BadRequest);

        establishments
            .MapGet("/{id:int}", GetByIdAsync)
            .WithName("GetEstablishment")
            .WithSummary("Get one establishment with its inspection history")
            .WithDescription(
                "Inspections are newest first, each with the violations cited during it. An " +
                "establishment that holds a permit but has never been inspected returns an empty " +
                "inspection list and isAwaitingFirstInspection = true; that is a real state, not " +
                "missing data.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        return api;
    }

    /// <summary>The default page size when the caller does not ask for one.</summary>
    private const int DefaultPageSize = 50;

    /// <summary>
    /// The largest page a caller may request. A ceiling exists because page size is the one input
    /// here that multiplies work for everyone: without it, <c>?pageSize=1000000</c> is a free
    /// denial-of-service that costs the caller one request.
    /// </summary>
    private const int MaxPageSize = 200;

    /// <summary>
    /// Validation happens here rather than in the query, and rejects rather than corrects.
    ///
    /// <para>Silently clamping a page size of 5,000 down to 200 would give the caller 200 rows while
    /// letting them believe they had asked for and received a complete answer — they would page
    /// wrongly and never see an error. Saying no is kinder than quietly doing something else.</para>
    /// </summary>
    private static async Task<Results<Ok<EstablishmentListResponse>, ProblemHttpResult>> ListAsync(
        IEstablishmentQueries queries,
        CancellationToken cancellationToken,
        string? nameStartsWith = null,
        string? cuisine = null,
        string? locality = null,
        InspectionOutcome? outcome = null,
        bool? awaitingFirstInspection = null,
        string? cursor = null,
        int pageSize = DefaultPageSize)
    {
        if (pageSize is < 1 or > MaxPageSize)
        {
            return Problem(
                "Invalid page size",
                $"pageSize must be between 1 and {MaxPageSize}. It was {pageSize}.");
        }

        EstablishmentCursor? after = null;

        if (!string.IsNullOrEmpty(cursor) && !EstablishmentCursorCodec.TryDecode(cursor, out after))
        {
            // 400 rather than 404 or an empty page. A malformed cursor is a bad request — the caller
            // sent something that is not a cursor at all. Returning an empty page instead would make
            // a client's paging bug look like the end of the data.
            return Problem(
                "Invalid cursor",
                "The cursor is not one this API issued. Omit it to start from the beginning.");
        }

        EstablishmentPage page = await queries.ListAsync(
            new EstablishmentListQuery
            {
                Filter = new EstablishmentFilter
                {
                    NameStartsWith = nameStartsWith,
                    Cuisine = cuisine,
                    Locality = locality,
                    Outcome = outcome,
                    IsAwaitingFirstInspection = awaitingFirstInspection,
                },
                After = after,
                PageSize = pageSize,
            },
            cancellationToken);

        return TypedResults.Ok(new EstablishmentListResponse
        {
            Items = page.Items,
            NextCursor = page.Next is null ? null : EstablishmentCursorCodec.Encode(page.Next),
        });
    }

    /// <summary>The default number of pins when the caller does not ask for one.</summary>
    private const int DefaultMapLimit = 1_000;

    /// <summary>
    /// The most pins one viewport may return. A chosen product limit, not a measured one, and worth
    /// being honest about: a map with more than a thousand pins on it is unreadable long before it
    /// is slow, and the right fix at that density is clustering rather than a bigger number. The
    /// response says when it truncated, so the client can ask the user to zoom instead of silently
    /// drawing a partial map.
    /// </summary>
    private const int MaxMapLimit = 5_000;

    /// <summary>
    /// The largest viewport, in degrees, on either axis.
    ///
    /// <para>Grounded in the data rather than picked: every establishment in the database falls
    /// inside 0.41° of latitude by 0.55° of longitude, measured on 2026-07-26. One degree therefore
    /// already covers every viewport that could return anything, with headroom. A request for more
    /// is not a map question, and refusing it bounds the work a single request can ask for.</para>
    /// </summary>
    private const double MaxViewportDegrees = 1.0;

    private static async Task<Results<Ok<MapResult>, ProblemHttpResult>> MapAsync(
        IEstablishmentQueries queries,
        CancellationToken cancellationToken,
        double? minLat = null,
        double? maxLat = null,
        double? minLon = null,
        double? maxLon = null,
        string? nameStartsWith = null,
        string? cuisine = null,
        string? locality = null,
        InspectionOutcome? outcome = null,
        bool? awaitingFirstInspection = null,
        int limit = DefaultMapLimit)
    {
        // Nullable doubles with a null default, so a missing bound is distinguishable from a
        // deliberate zero. Defaulting them to 0 would silently turn a forgotten parameter into a
        // viewport off the coast of Africa and return an empty map rather than an error.
        if (minLat is null || maxLat is null || minLon is null || maxLon is null)
        {
            return Problem(
                "Incomplete viewport",
                "All four of minLat, maxLat, minLon and maxLon are required.");
        }

        if (minLat < -90 || maxLat > 90 || minLon < -180 || maxLon > 180)
        {
            return Problem(
                "Viewport outside the world",
                "Latitude must be between -90 and 90, longitude between -180 and 180.");
        }

        // Inverted rather than merely empty. Swapping min and max is the single most likely caller
        // mistake, and it produces a silently empty map — which looks exactly like a part of the
        // city with no restaurants in it.
        if (minLat >= maxLat || minLon >= maxLon)
        {
            return Problem(
                "Inverted viewport",
                "minLat must be less than maxLat, and minLon less than maxLon.");
        }

        if (maxLat - minLat > MaxViewportDegrees || maxLon - minLon > MaxViewportDegrees)
        {
            return Problem(
                "Viewport too large",
                $"A viewport may span at most {MaxViewportDegrees} degrees on each axis. " +
                "The whole dataset fits inside that.");
        }

        if (limit is < 1 or > MaxMapLimit)
        {
            return Problem(
                "Invalid limit",
                $"limit must be between 1 and {MaxMapLimit}. It was {limit}.");
        }

        MapResult result = await queries.MapAsync(
            new MapViewport
            {
                MinLatitude = minLat.Value,
                MaxLatitude = maxLat.Value,
                MinLongitude = minLon.Value,
                MaxLongitude = maxLon.Value,
                Filter = new EstablishmentFilter
                {
                    NameStartsWith = nameStartsWith,
                    Cuisine = cuisine,
                    Locality = locality,
                    Outcome = outcome,
                    IsAwaitingFirstInspection = awaitingFirstInspection,
                },
                Limit = limit,
            },
            cancellationToken);

        return TypedResults.Ok(result);
    }

    private static ProblemHttpResult Problem(string title, string detail)
        => TypedResults.Problem(
            title: title, detail: detail, statusCode: StatusCodes.Status400BadRequest);

    /// <summary>
    /// The <c>:int</c> route constraint means a non-numeric id never reaches this method — the
    /// route simply does not match, and the request falls through to a 404. That is deliberate:
    /// /establishments/banana names no resource, and 404 says so. It is still ProblemDetails-shaped,
    /// because UseStatusCodePages gives a body to status codes produced without one.
    /// </summary>
    private static async Task<Results<Ok<EstablishmentDetail>, ProblemHttpResult>> GetByIdAsync(
        int id,
        IEstablishmentQueries queries,
        CancellationToken cancellationToken)
    {
        EstablishmentDetail? establishment = await queries.GetAsync(id, cancellationToken);

        if (establishment is null)
        {
            return TypedResults.Problem(
                title: "Establishment not found",
                detail: $"No establishment has id {id}.",
                statusCode: StatusCodes.Status404NotFound);
        }

        return TypedResults.Ok(establishment);
    }
}
