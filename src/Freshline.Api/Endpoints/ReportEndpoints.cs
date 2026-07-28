using Freshline.Api.RateLimiting;
using Freshline.Core.Model;
using Freshline.Core.Queries;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Freshline.Api.Endpoints;

/// <summary>
/// The aggregate endpoints — questions about the dataset rather than about a viewport.
///
/// <para>In their own route group with their own rate-limit policy, because a report costs many
/// times what a map query costs and is asked for far less often. See
/// <see cref="PublicApiRateLimiting.ReportPolicyName"/>.</para>
/// </summary>
internal static class ReportEndpoints
{
    public static RouteGroupBuilder MapReportEndpoints(this RouteGroupBuilder api)
    {
        RouteGroupBuilder reports = api
            .MapGroup("/reports")
            .WithTags("Reports")
            .RequireRateLimiting(PublicApiRateLimiting.ReportPolicyName)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        reports
            .MapGet("/outcome-breakdown", GetOutcomeBreakdownAsync)
            .WithName("GetOutcomeBreakdown")
            .WithSummary("How inspection results distribute across boroughs or cuisines")
            .WithDescription(
                "Counts establishments, not inspections: each establishment contributes exactly " +
                "one outcome, its latest counted inspection. Counting inspections instead would " +
                "weight an establishment visited six times six times as heavily, measuring " +
                "inspection frequency while appearing to measure results.\n\n" +
                "A date range narrows which inspections count, and an establishment's outcome " +
                "becomes its latest inspection *within* that range — so a report about 2025 " +
                "describes 2025. Establishments inspected outside the range are reported as " +
                "noInspectionInPeriod, which is a different fact from neverInspected and is kept " +
                "in its own column.\n\n" +
                "Rates are over `inspected`, not over `total`. Including never-inspected " +
                "establishments in the denominator would dilute every rate by how thoroughly the " +
                "city has visited that group, so a borough with a large backlog would appear to " +
                "have better results than one that has been inspected.\n\n" +
                "Rows are ordered worst-first by poorShare.supportedAtLeast — the lower bound of a " +
                "95% Wilson score interval — rather than by the observed rate, so a cuisine with " +
                "two establishments and one poor result does not outrank one with four hundred. " +
                "The displayed rate, poorShare.observed, is the true observed proportion and is " +
                "never adjusted. See ADR-0007.\n\n" +
                "ungroupedEstablishments counts establishments excluded because the grouping " +
                "column is null — 3,605 have no cuisine, exactly those never inspected. It is " +
                "reported so the totals can be reconciled against /establishments/summary rather " +
                "than appearing to be missing.")
            .ProducesProblem(StatusCodes.Status400BadRequest);

        reports
            .MapGet("/establishments", GetEstablishmentsAsync)
            .WithName("GetEstablishmentReport")
            .WithSummary("The establishments themselves, filtered, with their latest result")
            .WithDescription(
                "The row-level counterpart to the outcome breakdown: that one answers how results " +
                "distribute, this one answers which places. " +
                "Bounded rather than paged, and deliberately so. /establishments is cursor-paged, " +
                "and a cursor is a position in one particular order — name — which is right for " +
                "walking the dataset and wrong for a table somebody wants sorted by worst result " +
                "or most recent inspection. Offset paging would allow server-side sorting and was " +
                "measured in M3 to degrade with depth (307 logical reads at page 461 against 9 for " +
                "keyset). So this returns up to `limit` rows with isTruncated, the same trade the " +
                "map endpoint makes, and the client sorts. " +
                "A date range narrows which inspections count, so the reported result is the " +
                "latest inspection within the period. Establishments with no inspection in the " +
                "period are still listed with a null outcome — they are part of the answer to " +
                "'what is in this borough', and dropping them would turn a list of establishments " +
                "into a list of inspections. " +
                "outcome and awaitingFirstInspection=true together return nothing, necessarily: an " +
                "establishment with no inspections has no outcome to match. That contradiction is " +
                "answered with zero rows rather than refused.")
            .ProducesProblem(StatusCodes.Status400BadRequest);

        return api;
    }

    /// <summary>
    /// The most rows a single report request will return.
    ///
    /// <para>Matches the map endpoint's cap. It is a bound on one response rather than a measured
    /// capacity figure, and 23,528 establishments means a caller who filters to nothing will hit
    /// it — which is what <c>isTruncated</c> is for.</para>
    /// </summary>
    private const int MaximumRows = 1000;

    private static async Task<Results<Ok<EstablishmentReport>, ProblemHttpResult>> GetEstablishmentsAsync(
        IReportQueries queries,
        [FromQuery] string? locality,
        [FromQuery] string? cuisine,
        [FromQuery] InspectionOutcome? outcome,
        [FromQuery] bool? awaitingFirstInspection,
        [FromQuery] DateOnly? inspectedFrom,
        [FromQuery] DateOnly? inspectedTo,
        [FromQuery] int? limit,
        CancellationToken cancellationToken)
    {
        if (inspectedFrom is not null && inspectedTo is not null && inspectedFrom > inspectedTo)
        {
            return BackwardsRange(inspectedFrom.Value, inspectedTo.Value);
        }

        // Clamped rather than refused. A limit above the cap is a caller asking for more than this
        // endpoint gives, and the honest answer is the cap plus isTruncated — not a 400 telling them
        // a number they had no way to know.
        int rows = Math.Clamp(limit ?? MaximumRows, 1, MaximumRows);

        EstablishmentReport report = await queries.GetEstablishmentsAsync(
            new EstablishmentReportQuery
            {
                Locality = string.IsNullOrWhiteSpace(locality) ? null : locality,
                Cuisine = string.IsNullOrWhiteSpace(cuisine) ? null : cuisine,
                Outcome = outcome,
                IsAwaitingFirstInspection = awaitingFirstInspection,
                InspectedFrom = inspectedFrom,
                InspectedTo = inspectedTo,
                Limit = rows,
            },
            cancellationToken);

        return TypedResults.Ok(report);
    }

    private static ProblemHttpResult BackwardsRange(DateOnly from, DateOnly to)
        => TypedResults.Problem(
            title: "Invalid date range",
            detail: $"inspectedFrom ({from:yyyy-MM-dd}) is after inspectedTo ({to:yyyy-MM-dd}).",
            statusCode: StatusCodes.Status400BadRequest);

    private static async Task<Results<Ok<OutcomeBreakdown>, ProblemHttpResult>> GetOutcomeBreakdownAsync(
        IReportQueries queries,
        [FromQuery] ReportDimension? dimension,
        [FromQuery] string? locality,
        [FromQuery] string? cuisine,
        [FromQuery] DateOnly? inspectedFrom,
        [FromQuery] DateOnly? inspectedTo,
        CancellationToken cancellationToken)
    {
        // Refused rather than silently swapped. A reversed range is a caller bug, and quietly
        // reordering it would return a report for a period they did not ask for — with no way to
        // tell, because the response does not echo the range back as corrected.
        if (inspectedFrom is not null && inspectedTo is not null && inspectedFrom > inspectedTo)
        {
            return BackwardsRange(inspectedFrom.Value, inspectedTo.Value);
        }

        OutcomeBreakdown breakdown = await queries.GetOutcomeBreakdownAsync(
            new OutcomeBreakdownQuery
            {
                // Locality by default: five groups, all of them large enough to say something about.
                // Cuisine has 89 groups with wildly unequal sizes and is the one that needs ADR-0007
                // most, so it is a choice the caller makes rather than the one they land on.
                Dimension = dimension ?? ReportDimension.Locality,
                Locality = string.IsNullOrWhiteSpace(locality) ? null : locality,
                Cuisine = string.IsNullOrWhiteSpace(cuisine) ? null : cuisine,
                InspectedFrom = inspectedFrom,
                InspectedTo = inspectedTo,
            },
            cancellationToken);

        return TypedResults.Ok(breakdown);
    }
}
