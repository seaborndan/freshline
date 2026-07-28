using System.Net;

namespace Freshline.Api.Tests;

/// <summary>
/// Recovering the client's address from behind a proxy, proved through the thing that depends on it.
///
/// <para>There is no endpoint that reports the address it decided you have, and adding one to make
/// this testable would be adding a way to ask the API about its own internals. The rate limiter is
/// the component whose whole behaviour turns on the answer, so the question "did it believe the
/// forged header?" is asked as "did these two requests share a bucket?".</para>
///
/// <para>This matters more than most tests here. Get it wrong in one direction and every caller
/// collapses into one bucket behind the ingress, so the first visitor to exhaust it locks out
/// everybody — the limiter becomes the outage it exists to prevent. Get it wrong in the other and
/// anyone can put a fresh value in a header on each request and never be limited at all, which
/// switches the limiter off for exactly the caller it exists to stop.</para>
/// </summary>
[Collection(ApiCollection.Name)]
public class ForwardedHeadersTests(ApiFixture fixture)
{
    private string SomeEstablishmentUrl => $"/api/v1/establishments/{fixture.Seeded.InspectedTwiceId}";

    /// <summary>
    /// A host with a two-request bucket that never refills, and <paramref name="proxyHopCount"/>
    /// proxies declared in front of it.
    /// </summary>
    private FreshlineApiFactory Behind(int proxyHopCount)
        => new(fixture.ConnectionString, new Dictionary<string, string>
        {
            ["RateLimiting:BurstSize"] = "2",
            ["RateLimiting:TokensPerPeriod"] = "1",
            ["RateLimiting:ReplenishmentPeriodSeconds"] = "3600",
            ["Ingress:ProxyHopCount"] = proxyHopCount.ToString(),
        });

    private static async Task<HttpStatusCode> GetAsync(HttpClient client, string url, string forwardedFor)
    {
        using HttpRequestMessage request = new(HttpMethod.Get, url);
        request.Headers.Add("X-Forwarded-For", forwardedFor);

        HttpResponseMessage response = await client.SendAsync(request);
        return response.StatusCode;
    }

    /// <summary>
    /// Two callers behind the same ingress get their own buckets, which is the entire point of
    /// reading the header at all. Without it they would share one and the first to spend it would
    /// lock out the second.
    /// </summary>
    [Fact]
    public async Task Separate_clients_behind_the_proxy_get_separate_buckets()
    {
        using FreshlineApiFactory factory = Behind(proxyHopCount: 1);
        HttpClient client = factory.CreateClient();

        // One caller spends its bucket exactly.
        Assert.Equal(HttpStatusCode.OK, await GetAsync(client, SomeEstablishmentUrl, "203.0.113.10"));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(client, SomeEstablishmentUrl, "203.0.113.10"));
        Assert.Equal(HttpStatusCode.TooManyRequests, await GetAsync(client, SomeEstablishmentUrl, "203.0.113.10"));

        // A different caller is unaffected by the first one's spending.
        Assert.Equal(HttpStatusCode.OK, await GetAsync(client, SomeEstablishmentUrl, "203.0.113.99"));
    }

    /// <summary>
    /// The security property, and the reason <c>ForwardLimit</c> is set to the number of proxies
    /// rather than left open.
    ///
    /// <para>A caller who forges the header does not replace the list — the ingress appends its own
    /// entry, so what arrives is "forged, real". The middleware reads right to left and stops after
    /// one entry, so the forged value is never reached. Here the forged value changes on every
    /// request and the real one does not, and the bucket is spent all the same.</para>
    ///
    /// <para>If this ever fails, the limiter can be switched off by anybody who can set a header.</para>
    /// </summary>
    [Fact]
    public async Task A_forged_leading_entry_does_not_buy_a_fresh_bucket()
    {
        using FreshlineApiFactory factory = Behind(proxyHopCount: 1);
        HttpClient client = factory.CreateClient();

        Assert.Equal(
            HttpStatusCode.OK,
            await GetAsync(client, SomeEstablishmentUrl, "10.0.0.1, 203.0.113.10"));
        Assert.Equal(
            HttpStatusCode.OK,
            await GetAsync(client, SomeEstablishmentUrl, "10.0.0.2, 203.0.113.10"));

        // A third forged value, the same real caller: refused, because only the rightmost entry
        // was ever read.
        Assert.Equal(
            HttpStatusCode.TooManyRequests,
            await GetAsync(client, SomeEstablishmentUrl, "10.0.0.3, 203.0.113.10"));
    }

    /// <summary>
    /// With no proxy declared — the default, and what runs locally — the header is not read at all.
    ///
    /// <para>This is the case that makes the default safe. On a machine with nothing in front of it,
    /// believing <c>X-Forwarded-For</c> would let any caller mint a bucket per request. Here every
    /// request carries a different forged address and they all count against the same real
    /// connection.</para>
    /// </summary>
    [Fact]
    public async Task The_header_is_ignored_when_no_proxy_is_declared()
    {
        using FreshlineApiFactory factory = Behind(proxyHopCount: 0);
        HttpClient client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.OK, await GetAsync(client, SomeEstablishmentUrl, "203.0.113.1"));
        Assert.Equal(HttpStatusCode.OK, await GetAsync(client, SomeEstablishmentUrl, "203.0.113.2"));
        Assert.Equal(
            HttpStatusCode.TooManyRequests,
            await GetAsync(client, SomeEstablishmentUrl, "203.0.113.3"));
    }
}
