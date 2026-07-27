using System.Net;

namespace Freshline.Api.Tests;

/// <summary>
/// The CORS policy, from a browser's point of view.
///
/// <para>Worth stating what these tests can and cannot prove. CORS is a rule browsers enforce on
/// themselves: the server's only job is to say who may read a response, and the browser is what
/// refuses to hand it over when the answer is nobody. These assertions are therefore about the
/// headers on the wire. They do not — and no server-side test could — prove a browser honours
/// them.</para>
///
/// <para>That is also why an absent header is a real failure rather than a cosmetic one. There is no
/// second line of defence in the browser to fall back on.</para>
/// </summary>
[Collection(ApiCollection.Name)]
public class CorsTests(ApiFixture fixture)
{
    private const string Allowed = "https://freshline.example";
    private const string NotAllowed = "https://someone-elses-site.example";

    private string SomeEstablishmentUrl => $"/api/v1/establishments/{fixture.Seeded.InspectedTwiceId}";

    private FreshlineApiFactory WithOrigins(params string[] origins)
    {
        Dictionary<string, string> settings = [];

        for (int index = 0; index < origins.Length; index++)
        {
            settings[$"Cors:AllowedOrigins:{index}"] = origins[index];
        }

        return new FreshlineApiFactory(fixture.ConnectionString, settings);
    }

    private static HttpRequestMessage FromOrigin(string method, string url, string origin)
    {
        HttpRequestMessage request = new(new HttpMethod(method), url);
        request.Headers.Add("Origin", origin);
        return request;
    }

    /// <summary>
    /// The list-valued CORS headers arrive as one comma-joined string rather than as repeated header
    /// values, so <c>GetValues</c> yields a single element like <c>"Authorization,Content-Type"</c>.
    /// Both spellings are legal HTTP and a caller must accept either; splitting here means these
    /// tests assert on what the header means rather than on how it happened to be serialised.
    /// </summary>
    private static string[] ListValued(HttpResponseMessage response, string header)
        => response.Headers.GetValues(header)
            .SelectMany(value => value.Split(',', StringSplitOptions.TrimEntries))
            .ToArray();

    [Fact]
    public async Task Allows_a_configured_origin_to_read_the_response()
    {
        using FreshlineApiFactory factory = WithOrigins(Allowed);

        HttpResponseMessage response = await factory.CreateClient()
            .SendAsync(FromOrigin("GET", SomeEstablishmentUrl, Allowed));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            Allowed,
            Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
    }

    /// <summary>
    /// An origin that is not on the list gets the data and cannot read it.
    ///
    /// <para>That distinction is the whole of CORS and is worth pinning down, because the response
    /// looking completely normal is what makes it easy to misread. The server still returns 200 with
    /// the full body — it has not authenticated anything and has not refused anything. What is
    /// missing is the header granting the calling script permission to look, and the browser is what
    /// enforces that. Anyone who wants this data without a browser can have it, which is correct: it
    /// is public data on an anonymous endpoint.</para>
    /// </summary>
    [Fact]
    public async Task Serves_an_unlisted_origin_but_does_not_let_it_read_the_response()
    {
        using FreshlineApiFactory factory = WithOrigins(Allowed);

        HttpResponseMessage response = await factory.CreateClient()
            .SendAsync(FromOrigin("GET", SomeEstablishmentUrl, NotAllowed));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(
            response.Headers.Contains("Access-Control-Allow-Origin"),
            "An unlisted origin must not be granted read access to the response.");
    }

    /// <summary>
    /// No origins configured means no cross-origin browser access at all. A misconfigured deployment
    /// should fail closed, so the default has to be the safe one rather than the convenient one.
    ///
    /// <para>This also guards the one risk in the Development fallback. <c>CrossOriginPolicy</c>
    /// allows <c>localhost:5173</c> when nothing is configured <em>and</em> the environment is
    /// Development, because <c>appsettings.Development.json</c> is gitignored and a value put there
    /// would exist on one machine only. The hazard in any such convenience is that it follows the
    /// build somewhere else. This host runs as <c>Testing</c> — not Development — with nothing
    /// configured, which is the exact shape of a deployed environment that was never set up, and it
    /// allows nothing. Widen the fallback past <c>IsDevelopment()</c> and this test fails.</para>
    /// </summary>
    [Fact]
    public async Task Allows_no_origin_when_none_is_configured_outside_development()
    {
        using FreshlineApiFactory factory = WithOrigins();

        HttpResponseMessage response = await factory.CreateClient()
            .SendAsync(FromOrigin("GET", SomeEstablishmentUrl, Allowed));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(
            response.Headers.Contains("Access-Control-Allow-Origin"),
            "An environment with no configured origins must allow none. The localhost fallback is " +
            "for Development only — see CrossOriginPolicy.DevelopmentOrigins.");
    }

    /// <summary>
    /// A preflight is answered without the request reaching an endpoint. This is what makes an
    /// <c>Authorization</c> header work from a browser at slice 6: a GET carrying one is not a
    /// "simple" request, so the browser asks permission with an OPTIONS first and sends nothing at
    /// all if the answer does not name the header.
    /// </summary>
    [Fact]
    public async Task Answers_a_preflight_for_an_authorized_get()
    {
        using FreshlineApiFactory factory = WithOrigins(Allowed);

        HttpRequestMessage preflight = FromOrigin("OPTIONS", SomeEstablishmentUrl, Allowed);
        preflight.Headers.Add("Access-Control-Request-Method", "GET");
        preflight.Headers.Add("Access-Control-Request-Headers", "authorization");

        HttpResponseMessage response = await factory.CreateClient().SendAsync(preflight);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(
            Allowed,
            Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Contains(
            "Authorization",
            ListValued(response, "Access-Control-Allow-Headers"),
            StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Credentials are not allowed, and this test exists so that stays deliberate.
    ///
    /// <para>Adding <c>AllowCredentials()</c> when auth arrives would look like the obvious next step
    /// and would be a mistake. Bearer tokens are attached explicitly by JavaScript, so they already
    /// cross origins without it; what it would add is the browser sending cookies automatically on
    /// cross-site requests, which is the mechanism cross-site request forgery runs on. The capability
    /// is not needed and the risk is real, so the answer is no.</para>
    /// </summary>
    [Fact]
    public async Task Does_not_allow_credentials()
    {
        using FreshlineApiFactory factory = WithOrigins(Allowed);

        HttpResponseMessage response = await factory.CreateClient()
            .SendAsync(FromOrigin("GET", SomeEstablishmentUrl, Allowed));

        Assert.False(
            response.Headers.Contains("Access-Control-Allow-Credentials"),
            "Allowing credentials would let a browser attach cookies to cross-site requests. " +
            "Bearer tokens do not need it — see CrossOriginPolicy.");
    }
}
