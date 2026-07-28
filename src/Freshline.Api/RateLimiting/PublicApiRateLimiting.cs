using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace Freshline.Api.RateLimiting;

/// <summary>
/// How much a single caller may ask for. Bound from the <c>RateLimiting</c> configuration section.
///
/// <para><strong>These three numbers are chosen, not measured.</strong> Nothing has established what
/// this API can serve, because that would need a load test against deployed hardware and
/// <c>docs/performance.md</c> is explicit that its figures come from one unconstrained workstation
/// with the whole database resident in memory. They are sized against the traffic a human browsing a
/// map produces, which is a different and much weaker justification. Said plainly here so nobody
/// quotes them as a capacity finding.</para>
/// </summary>
public sealed class RateLimitOptions
{
    public const string SectionName = "RateLimiting";

    /// <summary>
    /// How many requests a caller may make back to back before being throttled at all.
    ///
    /// <para>A map client is bursty: panning fires several viewport requests within a second or two,
    /// then the user reads the screen for a minute. The burst is the normal shape of the traffic,
    /// not abuse, and a limiter that cannot absorb it would throttle the ordinary case.</para>
    /// </summary>
    [Range(1, 100_000)]
    public int BurstSize { get; set; } = 60;

    /// <summary>How many requests are handed back each <see cref="ReplenishmentPeriodSeconds"/>.</summary>
    [Range(1, 100_000)]
    public int TokensPerPeriod { get; set; } = 30;

    /// <summary>
    /// How often the bucket refills. With the defaults — 30 tokens every 10 seconds — the sustained
    /// rate is 3 requests a second, on top of a burst of 60.
    /// </summary>
    [Range(1, 3_600)]
    public int ReplenishmentPeriodSeconds { get; set; } = 10;
}

/// <summary>
/// How much reporting a single caller may ask for. Bound from <c>RateLimiting:Reports</c>.
///
/// <para><strong>Chosen, not measured</strong> — the same caveat as <see cref="RateLimitOptions"/>,
/// and it applies harder here because no report has been measured at all. Sized against the shape of
/// the interaction rather than the cost of the query: somebody opens a report, changes a filter two
/// or three times, reads the table, exports it. That is a small burst and then nothing.</para>
/// </summary>
public sealed class ReportRateLimitOptions
{
    public const string SectionName = "RateLimiting:Reports";

    /// <summary>Back-to-back report requests allowed before throttling. Enough to change filters a
    /// few times while reading.</summary>
    [Range(1, 10_000)]
    public int BurstSize { get; set; } = 15;

    /// <summary>How many requests are handed back each <see cref="ReplenishmentPeriodSeconds"/>.</summary>
    [Range(1, 10_000)]
    public int TokensPerPeriod { get; set; } = 10;

    /// <summary>
    /// How often the report bucket refills. With the defaults — 10 every 60 seconds — the sustained
    /// rate is one report request every six seconds, on top of a burst of 15.
    /// </summary>
    [Range(1, 3_600)]
    public int ReplenishmentPeriodSeconds { get; set; } = 60;
}

/// <summary>
/// Rate limiting for the public read endpoints.
///
/// <para><strong>No package was added for this.</strong> <c>Microsoft.AspNetCore.RateLimiting</c> and
/// <c>System.Threading.RateLimiting</c> are both in the ASP.NET Core shared framework, so this is a
/// framework feature rather than a dependency decision under CLAUDE.md.</para>
/// </summary>
internal static class PublicApiRateLimiting
{
    /// <summary>
    /// The report endpoints' own policy, separate from <see cref="PolicyName"/>.
    ///
    /// <para><strong>Why this is not the same bucket.</strong> ADR-0005 put every data endpoint in
    /// one bucket, sized against what a person panning a map produces — bursty, cheap, constant. A
    /// report is the opposite shape: it aggregates over a large share of the table, it is asked for
    /// rarely, and one of them costs many times what a viewport query costs. Sharing a bucket means
    /// a handful of report requests can exhaust a map user's allowance, and a map user panning
    /// briskly can lock somebody out of the reports page. Two different shapes of traffic want two
    /// different budgets.</para>
    ///
    /// <para>This is the amendment to ADR-0005 booked in
    /// <c>docs/milestones/m5b-landing-and-reporting.md</c>.</para>
    /// </summary>
    public const string ReportPolicyName = "reports";

    /// <summary>
    /// Named rather than global, because the endpoints that must <em>not</em> be limited matter more
    /// than the ones that must. See the health-check note on <see cref="AddPublicApiRateLimiting"/>.
    /// </summary>
    public const string PolicyName = "public";

    /// <summary>
    /// The partition every request with no usable client address falls into. They share one bucket
    /// rather than going unlimited: an unattributable request is still load.
    /// </summary>
    private const string UnattributableCaller = "unattributable";

    /// <summary>
    /// One token bucket per client IP.
    ///
    /// <para><strong>Why a token bucket and not a fixed window.</strong> A fixed window lets a caller
    /// spend the whole allowance at the end of one window and the whole allowance again at the start
    /// of the next — twice the intended rate, in an instant, purely as a function of where their
    /// burst lands relative to a clock. A token bucket has no boundary to sit on: it refills
    /// continuously, so the sustained rate is the sustained rate no matter when the requests
    /// arrive.</para>
    ///
    /// <para><strong>Why one policy across all three endpoints and not one per endpoint.</strong> The
    /// map query is the expensive one, but the cheapest endpoint here still reaches the database, and
    /// what needs bounding is the load one caller can put on that database. Three separate buckets
    /// would let a caller spend three budgets at once, which is the opposite of the intent.</para>
    ///
    /// <para><strong>What this does not protect against, stated rather than implied.</strong> It is
    /// per-IP, so it slows one caller down and does nothing about many. It is per-instance, held in
    /// this process's memory, so two instances behind a load balancer permit twice the rate. Neither
    /// is a reason not to have it — the thing it does stop is one script walking the whole dataset as
    /// fast as it can — but it is not a defence against a distributed attack and should not be
    /// described as one.</para>
    /// </summary>
    public static IServiceCollection AddPublicApiRateLimiting(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services
            .AddOptions<RateLimitOptions>()
            .Bind(configuration.GetSection(RateLimitOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();

        services
            .AddOptions<ReportRateLimitOptions>()
            .Bind(configuration.GetSection(ReportRateLimitOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();

        services.AddRateLimiter(limiter =>
        {
            // The default is 503, which says "this server is broken" when the truth is "you are
            // going too fast". 429 is the code that tells a client to slow down and try again, and
            // it is the one a well-behaved client already knows how to handle.
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            limiter.AddPolicy(PolicyName, httpContext =>
            {
                RateLimitOptions settings = httpContext.RequestServices
                    .GetRequiredService<IOptions<RateLimitOptions>>().Value;

                return RateLimitPartition.GetTokenBucketLimiter(
                    PartitionKeyFor(httpContext),
                    _ => new TokenBucketRateLimiterOptions
                    {
                        TokenLimit = settings.BurstSize,
                        TokensPerPeriod = settings.TokensPerPeriod,
                        ReplenishmentPeriod = TimeSpan.FromSeconds(settings.ReplenishmentPeriodSeconds),
                        AutoReplenishment = true,

                        // Reject immediately rather than hold the request until a token frees up.
                        // A queue turns a fast 429 into a slow 200, which is worse in both
                        // directions: the caller cannot tell they are being throttled and so never
                        // slows down, and the server holds open connections for requests it has
                        // already decided are excess.
                        QueueLimit = 0,
                        QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                    });
            });

            // The reports policy. Same token-bucket reasoning, different budget, and a partition key
            // deliberately prefixed so a caller's report allowance and map allowance cannot collide
            // in the dictionary the limiter keys on.
            limiter.AddPolicy(ReportPolicyName, httpContext =>
            {
                ReportRateLimitOptions settings = httpContext.RequestServices
                    .GetRequiredService<IOptions<ReportRateLimitOptions>>().Value;

                return RateLimitPartition.GetTokenBucketLimiter(
                    $"reports:{PartitionKeyFor(httpContext)}",
                    _ => new TokenBucketRateLimiterOptions
                    {
                        TokenLimit = settings.BurstSize,
                        TokensPerPeriod = settings.TokensPerPeriod,
                        ReplenishmentPeriod = TimeSpan.FromSeconds(settings.ReplenishmentPeriodSeconds),
                        AutoReplenishment = true,
                        QueueLimit = 0,
                        QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                    });
            });

            limiter.OnRejected = async (context, cancellationToken) =>
            {
                RateLimitOptions settings = context.HttpContext.RequestServices
                    .GetRequiredService<IOptions<RateLimitOptions>>().Value;

                // How long until a token is available. The limiter knows exactly, so the response
                // says so rather than making the client guess and back off blindly.
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out TimeSpan retryAfter))
                {
                    context.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(
                        retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
                }

                // Written explicitly rather than left to UseStatusCodePages. That would produce a
                // correctly shaped ProblemDetails with a generic title and no detail, and the one
                // thing a throttled caller needs to know is what the limit actually is.
                IProblemDetailsService problemDetails = context.HttpContext.RequestServices
                    .GetRequiredService<IProblemDetailsService>();

                // Which budget was actually spent. Reports have their own, and a 429 from the report
                // endpoint quoting the map's numbers would send a caller away to wait the wrong
                // amount of time for the wrong reason.
                bool isReport = context.HttpContext.GetEndpoint()
                    ?.Metadata.GetMetadata<EnableRateLimitingAttribute>()
                    ?.PolicyName == ReportPolicyName;

                (int perPeriod, int seconds, int burst, string what) = isReport
                    ? Describe(context.HttpContext.RequestServices
                        .GetRequiredService<IOptions<ReportRateLimitOptions>>().Value)
                    : (settings.TokensPerPeriod, settings.ReplenishmentPeriodSeconds,
                       settings.BurstSize, "requests");

                await problemDetails.TryWriteAsync(new ProblemDetailsContext
                {
                    HttpContext = context.HttpContext,
                    ProblemDetails =
                    {
                        Status = StatusCodes.Status429TooManyRequests,
                        Title = "Too many requests",

                        // Stated in the period's own terms — "30 requests every 10 seconds" — rather
                        // than divided into a per-second rate. A first version of this message did
                        // divide, and a live run with a slow replenishment period had it telling
                        // callers the API allows "roughly 0 requests per second": true to two
                        // decimal places and useless. These are the configured numbers verbatim, so
                        // there is nothing to round away.
                        Detail =
                            $"This API allows {perPeriod} {what} every {seconds} seconds per " +
                            $"client, after an initial burst of {burst}. Retry after the interval " +
                            "in the Retry-After header.",
                    },
                });
            };
        });

        return services;
    }

    /// <summary>
    /// The caller's IP address, or a shared bucket when there is not one.
    ///
    /// <para><strong>This is correct today and will be wrong the moment there is a proxy in
    /// front.</strong> Behind a reverse proxy, CDN or Azure ingress, <c>RemoteIpAddress</c> is the
    /// proxy's address, so every caller in the world collapses into a single bucket and the limiter
    /// stops being a per-client limit and becomes a global one that locks everybody out at once.</para>
    ///
    /// <para><strong>Since resolved, and not the way this comment originally predicted.</strong> The
    /// fix was assumed to be <c>UseForwardedHeaders</c> with <c>KnownProxies</c> populated — and that
    /// turned out to be unfollowable on the deployment target, where the ingress addresses are
    /// platform-managed and unpublished. Trust is bounded by <c>ForwardLimit</c> instead, so only the
    /// entries the proxies themselves appended are ever read. See
    /// <c>Freshline.Api.Hosting.IngressConfiguration</c> and ADR-0006, which supersedes the
    /// instruction ADR-0005 gave here.</para>
    /// </summary>
    /// <summary>The report budget's numbers, in the shape the rejection message wants them.</summary>
    private static (int PerPeriod, int Seconds, int Burst, string What) Describe(
        ReportRateLimitOptions settings)
        => (settings.TokensPerPeriod, settings.ReplenishmentPeriodSeconds, settings.BurstSize,
            "report requests");

    private static string PartitionKeyFor(HttpContext httpContext)
        => httpContext.Connection.RemoteIpAddress?.ToString() ?? UnattributableCaller;
}
