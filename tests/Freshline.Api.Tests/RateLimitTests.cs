using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Freshline.Api.Tests;

/// <summary>
/// The rate limiter, proved by exhausting it.
///
/// <para>Each test starts its own host with a bucket small enough to empty in a few requests, rather
/// than firing thousands at the shared fixture to reach the production default. The limits are the
/// thing under test, so they are set by the test; what is <em>not</em> set by the test is any of the
/// behaviour — the policy, the partitioning, the status code and the response body are the real
/// ones.</para>
///
/// <para>Sharing the <see cref="ApiCollection"/> keeps these from running in parallel with the other
/// endpoint tests. They point at the same seeded database, and a second host starting while another
/// is mid-request is avoidable noise.</para>
/// </summary>
[Collection(ApiCollection.Name)]
public class RateLimitTests(ApiFixture fixture)
{
    /// <summary>Any endpoint inside the limited group; the detail one is the cheapest.</summary>
    private string SomeEstablishmentUrl => $"/api/v1/establishments/{fixture.Seeded.InspectedTwiceId}";

    /// <summary>
    /// A bucket of <paramref name="burstSize"/> that refills once an hour, so nothing replenishes
    /// during a test and the count of allowed requests is exact rather than a race against a timer.
    /// </summary>
    private FreshlineApiFactory Throttled(int burstSize, params string[] allowedOrigins)
    {
        Dictionary<string, string> settings = new()
        {
            ["RateLimiting:BurstSize"] = burstSize.ToString(),
            ["RateLimiting:TokensPerPeriod"] = "1",
            ["RateLimiting:ReplenishmentPeriodSeconds"] = "3600",
        };

        for (int index = 0; index < allowedOrigins.Length; index++)
        {
            settings[$"Cors:AllowedOrigins:{index}"] = allowedOrigins[index];
        }

        return new FreshlineApiFactory(fixture.ConnectionString, settings);
    }

    /// <summary>
    /// The burst is spent exactly, then the next request is refused. Not "eventually refused" — the
    /// fourth request of a bucket of three, which is what makes this a test of the limit rather than
    /// a test that some limit exists.
    /// </summary>
    [Fact]
    public async Task Allows_the_burst_and_refuses_the_request_after_it()
    {
        using FreshlineApiFactory factory = Throttled(burstSize: 3);
        HttpClient client = factory.CreateClient();

        for (int request = 1; request <= 3; request++)
        {
            HttpResponseMessage allowed = await client.GetAsync(SomeEstablishmentUrl);
            Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        }

        HttpResponseMessage refused = await client.GetAsync(SomeEstablishmentUrl);

        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
    }

    /// <summary>
    /// 429, not 503. The framework's default rejection status is 503 Service Unavailable, which tells
    /// a client the server is broken when the truth is that the client is going too fast — and the
    /// two call for opposite reactions.
    /// </summary>
    [Fact]
    public async Task Refuses_with_a_problem_details_body_and_a_retry_after_header()
    {
        using FreshlineApiFactory factory = Throttled(burstSize: 1);
        HttpClient client = factory.CreateClient();

        await client.GetAsync(SomeEstablishmentUrl);
        HttpResponseMessage refused = await client.GetAsync(SomeEstablishmentUrl);

        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);

        // CLAUDE.md: every failure path is ProblemDetails. A rejection produced by middleware rather
        // than by an endpoint is the one most likely to be missed, because no endpoint code runs.
        Assert.Equal("application/problem+json", refused.Content.Headers.ContentType?.MediaType);

        JsonElement problem = await refused.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(429, problem.GetProperty("status").GetInt32());
        Assert.Equal("Too many requests", problem.GetProperty("title").GetString());

        // The detail has to name the actual limit, and this fixture's limit is deliberately an
        // extreme one — 1 token per hour. An earlier version of the message divided those into a
        // per-second rate and told the caller the API allows "roughly 0 requests per second", which
        // a live run caught and no assertion on title or status ever would have.
        string detail = problem.GetProperty("detail").GetString() ?? string.Empty;
        Assert.Contains("3600 seconds", detail, StringComparison.Ordinal);
        Assert.DoesNotContain("0 requests", detail, StringComparison.Ordinal);

        // The limiter knows exactly when a token frees up, so the response says so rather than
        // leaving the client to guess. Asserted as a real value because the alternative — the header
        // silently absent — looks identical to a client that never checks it.
        Assert.True(
            refused.Headers.RetryAfter?.Delta > TimeSpan.Zero,
            "A 429 must carry a Retry-After the client can act on. It was: " +
            (refused.Headers.RetryAfter?.ToString() ?? "absent"));
    }

    /// <summary>
    /// The health checks sit outside the limited route group, and this is the test that says why.
    ///
    /// <para>A readiness probe is polled continuously from a handful of addresses — exactly the shape
    /// a per-IP limiter classifies as abuse. If it were throttled, the load balancer would get a 429,
    /// read it as an unhealthy instance, and pull the instance out of rotation. The rate limiter
    /// would have caused the outage it exists to prevent.</para>
    /// </summary>
    [Fact]
    public async Task Does_not_throttle_the_health_checks()
    {
        using FreshlineApiFactory factory = Throttled(burstSize: 1);
        HttpClient client = factory.CreateClient();

        // Spend the bucket, so anything shared would already be empty.
        await client.GetAsync(SomeEstablishmentUrl);
        Assert.Equal(
            HttpStatusCode.TooManyRequests,
            (await client.GetAsync(SomeEstablishmentUrl)).StatusCode);

        for (int probe = 0; probe < 5; probe++)
        {
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
        }
    }

    /// <summary>
    /// The OpenAPI document is outside the group too. M4 is done when a stranger can explore live
    /// documentation, and a document that 429s while they read it fails that criterion — for a
    /// request that touches no database.
    /// </summary>
    [Fact]
    public async Task Does_not_throttle_the_openapi_document()
    {
        using FreshlineApiFactory factory = Throttled(burstSize: 1);
        HttpClient client = factory.CreateClient();

        await client.GetAsync(SomeEstablishmentUrl);
        Assert.Equal(
            HttpStatusCode.TooManyRequests,
            (await client.GetAsync(SomeEstablishmentUrl)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/openapi/v1.json")).StatusCode);
    }

    /// <summary>
    /// The reason <c>UseCors</c> is registered before <c>UseRateLimiter</c> rather than after.
    ///
    /// <para>A 429 without CORS headers is unreadable to a browser: the response arrives, the browser
    /// refuses to hand it to the calling script, and the script sees an opaque network error. It
    /// cannot tell "slow down, retry in 30 seconds" from "the API is down" — which is the single
    /// distinction a 429 exists to communicate. Reversing the two middleware registrations breaks
    /// this test and nothing else, which is exactly why the test is here.</para>
    /// </summary>
    [Fact]
    public async Task A_throttled_response_still_carries_the_cors_headers_a_browser_needs()
    {
        const string Origin = "https://freshline.example";

        using FreshlineApiFactory factory = Throttled(burstSize: 1, allowedOrigins: Origin);
        HttpClient client = factory.CreateClient();

        await client.GetAsync(SomeEstablishmentUrl);

        HttpRequestMessage request = new(HttpMethod.Get, SomeEstablishmentUrl);
        request.Headers.Add("Origin", Origin);
        HttpResponseMessage refused = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.Equal(
            Origin,
            Assert.Single(refused.Headers.GetValues("Access-Control-Allow-Origin")));

        // Retry-After is not on the CORS-safelisted response headers, so without an explicit
        // exposure the browser hides it from the script even though it is on the wire. The most
        // useful half of the answer would be invisible to the only client type CORS applies to.
        // Split on commas: the list-valued CORS headers come back as one joined string rather than
        // as repeated values, so this would pass today by luck and break the moment a second header
        // were exposed.
        Assert.Contains(
            "Retry-After",
            refused.Headers.GetValues("Access-Control-Expose-Headers")
                .SelectMany(value => value.Split(',', StringSplitOptions.TrimEntries)),
            StringComparer.OrdinalIgnoreCase);
    }
}
