using Freshline.Api.RateLimiting;
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

        return api;
    }

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
            return TypedResults.Problem(
                title: "Invalid date range",
                detail: $"inspectedFrom ({inspectedFrom:yyyy-MM-dd}) is after inspectedTo " +
                        $"({inspectedTo:yyyy-MM-dd}).",
                statusCode: StatusCodes.Status400BadRequest);
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
