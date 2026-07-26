using Freshline.Core.Queries;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Freshline.Api.Endpoints;

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
