using Freshline.Core.Queries;
using Freshline.Api.RateLimiting;
namespace Freshline.Api.Endpoints;
internal static class ResearchEndpoints
{
    public static void MapResearchEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/research", async (IResearchQueries queries, CancellationToken cancellationToken,
            string? locality = null, string? cuisine = null, string? codes = null, bool requireAll = false,
            bool prePermit = false, DateOnly? from = null, DateOnly? to = null) =>
        {
            var parsed = (codes ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Distinct().ToArray();
            var end = to ?? DateOnly.FromDateTime(DateTime.UtcNow);
            var start = from ?? end.AddDays(-179);
            if (locality?.Length > 100 || cuisine?.Length > 100 || start > end || parsed.Length > 10 || parsed.Any(c => c.Length > 12 || !c.All(ch => char.IsAsciiLetterOrDigit(ch) || ch == '-')))
                return Results.Problem(statusCode: 400, title: "Invalid research filters", detail: "Use a valid date range and at most ten citation codes containing letters, numbers or hyphens.");
            return Results.Ok(await queries.FindAsync(string.IsNullOrWhiteSpace(locality) ? null : locality.Trim(), string.IsNullOrWhiteSpace(cuisine) ? null : cuisine.Trim(), parsed, requireAll, prePermit, start, end, cancellationToken));
        }).WithTags("Research").RequireRateLimiting(PublicApiRateLimiting.ReportPolicyName);
    }
}
