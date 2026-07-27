using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Freshline.Api.Endpoints;

/// <summary>
/// Who the caller is, according to their token.
/// </summary>
public sealed record CallerIdentity
{
    /// <summary>The <c>sub</c> claim — the issuer's identifier for this caller.</summary>
    public required string Subject { get; init; }

    /// <summary>The roles on the token, empty rather than null when there are none.</summary>
    public required IReadOnlyList<string> Roles { get; init; }

    /// <summary>
    /// When this token stops being accepted, from its <c>exp</c> claim. Null only if a token somehow
    /// validated without one, which <c>RequireExpirationTime</c> should make impossible.
    /// </summary>
    public DateTimeOffset? ExpiresAt { get; init; }
}

/// <summary>
/// The one authenticated endpoint in M4.
///
/// <para><strong>Why it exists at all.</strong> The milestone's rule is that an endpoint triggering or
/// controlling ingestion must be authenticated — and M4 has no such endpoint, because ingestion is
/// the worker's job and putting a trigger here would widen the scope this milestone fenced. That
/// leaves auth configured and nothing using it, which is the state in which auth is broken and
/// nobody finds out until M6 depends on it.</para>
///
/// <para>This endpoint closes that gap without inventing a feature. It reads the validated principal
/// and returns it, so the whole chain — header parsed, signature checked against the public key,
/// issuer, audience, algorithm and lifetime validated, claims materialised — is exercised by a real
/// request rather than asserted about. It is also the thing a client debugging its own token
/// reaches for first.</para>
/// </summary>
internal static class IdentityEndpoints
{
    public static RouteGroupBuilder MapIdentityEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/me", GetCaller)
            .RequireAuthorization()
            .WithTags("Identity")
            .WithName("GetCaller")
            .WithSummary("Who the bearer token says you are")
            .WithDescription(
                "The only endpoint here that requires a token; the establishment endpoints are " +
                "anonymous by design. Returns the validated claims, which makes it the quickest way " +
                "to tell a rejected token from a wrongly addressed request. This API validates " +
                "tokens and does not issue them, so there is no endpoint to obtain one from.")
            .ProducesProblem(StatusCodes.Status401Unauthorized);

        return api;
    }

    /// <summary>
    /// <c>ClaimsPrincipal</c> comes from the authorization middleware, and the endpoint is behind
    /// <c>RequireAuthorization</c>, so an unauthenticated request never arrives here — it is refused
    /// with a 401 before this method is reached.
    /// </summary>
    private static Ok<CallerIdentity> GetCaller(ClaimsPrincipal caller)
        => TypedResults.Ok(new CallerIdentity
        {
            // Non-null because the endpoint requires an authenticated principal and
            // NameClaimType is "sub", so a token without one fails validation rather than
            // arriving here with a null identity. Falls back rather than dereferencing with `!`,
            // per CLAUDE.md: a suppression here would be a claim about token contents this code
            // cannot make on its own.
            Subject = caller.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? "unknown",

            Roles = caller.FindAll("role").Select(claim => claim.Value).ToArray(),

            ExpiresAt = ExpiryOf(caller),
        });

    /// <summary>
    /// <c>exp</c> is seconds since the Unix epoch, as a string. Parsed rather than trusted: this
    /// value is reported to the caller, and a token that validated could still carry an
    /// <c>exp</c> this code cannot read.
    /// </summary>
    private static DateTimeOffset? ExpiryOf(ClaimsPrincipal caller)
        => long.TryParse(caller.FindFirstValue(JwtRegisteredClaimNames.Exp), out long secondsSinceEpoch)
            ? DateTimeOffset.FromUnixTimeSeconds(secondsSinceEpoch)
            : null;
}
