using Freshline.Api.RateLimiting;
using Freshline.Core.Queries;

namespace Freshline.Api.Endpoints;

internal static class ProspectEndpoints
{
    public static void MapProspectEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/prospects", async (IProspectQueries queries, CancellationToken cancellationToken,
            string? locality = null, DateOnly? from = null, DateOnly? to = null) =>
        {
            DateOnly end = to ?? DateOnly.FromDateTime(DateTime.UtcNow);
            DateOnly start = from ?? end.AddDays(-180);
            if (start > end || locality?.Length > 100)
            {
                return Results.Problem(statusCode: 400, title: "Invalid prospect filters",
                    detail: "Start date must not follow end date; borough must be at most 100 characters.");
            }

            return Results.Ok(await queries.FindAsync(
                string.IsNullOrWhiteSpace(locality) ? null : locality.Trim(), start, end, cancellationToken));
        }).WithTags("Prospects").RequireRateLimiting(PublicApiRateLimiting.ReportPolicyName);
    }
}
