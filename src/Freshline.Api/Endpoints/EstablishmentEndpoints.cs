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
            .WithTags("Establishments");

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
            return TypedResults.Problem(
                title: "Invalid page size",
                detail: $"pageSize must be between 1 and {MaxPageSize}. It was {pageSize}.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        EstablishmentCursor? after = null;

        if (!string.IsNullOrEmpty(cursor) && !EstablishmentCursorCodec.TryDecode(cursor, out after))
        {
            // 400 rather than 404 or an empty page. A malformed cursor is a bad request — the caller
            // sent something that is not a cursor at all. Returning an empty page instead would make
            // a client's paging bug look like the end of the data.
            return TypedResults.Problem(
                title: "Invalid cursor",
                detail: "The cursor is not one this API issued. Omit it to start from the beginning.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        EstablishmentPage page = await queries.ListAsync(
            new EstablishmentListQuery
            {
                NameStartsWith = nameStartsWith,
                Cuisine = cuisine,
                Locality = locality,
                Outcome = outcome,
                IsAwaitingFirstInspection = awaitingFirstInspection,
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
