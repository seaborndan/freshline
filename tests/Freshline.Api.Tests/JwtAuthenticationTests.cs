using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace Freshline.Api.Tests;

/// <summary>
/// Token validation, mostly proved by the tokens that must be refused.
///
/// <para>The accepting case is one test. The rest are forgeries, near-misses and expired
/// credentials, because that is where the failure mode lives: auth that accepts a valid token is
/// obviously working, and auth that <em>also</em> accepts an invalid one looks exactly the same from
/// the outside. Every rejection test below varies one thing from a token that would otherwise be
/// accepted, so a pass cannot come from the token being malformed in some incidental way.</para>
/// </summary>
[Collection(ApiCollection.Name)]
public class JwtAuthenticationTests(ApiFixture fixture) : IDisposable
{
    private readonly TestTokens _tokens = new();

    public void Dispose() => _tokens.Dispose();

    /// <summary>A host configured with the test issuer's public key — and only the public key.</summary>
    private FreshlineApiFactory ConfiguredForTestIssuer()
        => new(fixture.ConnectionString, new Dictionary<string, string>
        {
            ["Jwt:Issuer"] = TestTokens.Issuer,
            ["Jwt:Audience"] = TestTokens.Audience,
            ["Jwt:PublicKeyPem"] = _tokens.PublicKeyPem,
            ["RateLimiting:BurstSize"] = "100000",
            ["RateLimiting:TokensPerPeriod"] = "100000",
        });

    private static async Task<HttpResponseMessage> GetMeAsync(FreshlineApiFactory factory, string? token)
    {
        HttpRequestMessage request = new(HttpMethod.Get, "/api/v1/me");

        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return await factory.CreateClient().SendAsync(request);
    }

    // ---------------------------------------------------------------------------------------------
    // What must be accepted
    // ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task Accepts_a_token_from_the_configured_issuer_and_reports_its_claims()
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();

        HttpResponseMessage response = await GetMeAsync(
            factory, _tokens.Mint(subject: "user-42", roles: ["operator", "reader"]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        JsonElement caller = await response.Content.ReadFromJsonAsync<JsonElement>();

        // "sub" read as itself. With MapInboundClaims left on, the framework rewrites it to a
        // WS-Federation URI and this comes back as "unknown" — which is why the subject is asserted
        // by value rather than merely being present.
        Assert.Equal("user-42", caller.GetProperty("subject").GetString());

        string[] roles = caller.GetProperty("roles")
            .EnumerateArray().Select(role => role.GetString()!).ToArray();
        Assert.Equal(["operator", "reader"], roles);

        Assert.True(caller.GetProperty("expiresAt").GetDateTimeOffset() > DateTimeOffset.UtcNow);
    }

    // ---------------------------------------------------------------------------------------------
    // What must be refused
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// The algorithm-confusion forgery: an HS256 token whose HMAC secret is the API's own published
    /// RSA public key. The attacker needs nothing this deployment has not published.
    ///
    /// <para><strong>What refuses it, stated accurately.</strong> The obvious answer is the
    /// <c>ValidAlgorithms</c> pin, and that is wrong — this test was run with that line deleted and
    /// still passed. What refuses it is the key set: <c>IssuerSigningKey</c> is an
    /// <c>RsaSecurityKey</c>, which cannot serve as an HMAC key, so nothing resolves for HS256. The
    /// pin is a second barrier and is isolated by
    /// <see cref="Refuses_a_token_signed_with_an_algorithm_the_api_did_not_pin"/>.</para>
    ///
    /// <para>The distinction is kept because a test whose comment claims the wrong cause is worse
    /// than no comment: it is the thing someone reads before deciding a line is redundant.</para>
    /// </summary>
    [Fact]
    public async Task Refuses_an_hmac_token_signed_with_the_public_key()
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();

        HttpResponseMessage response = await GetMeAsync(
            factory, _tokens.MintWithPublicKeyAsHmacSecret(subject: "administrator"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// RS512, signed by the correct private key, for the correct issuer and audience. Everything
    /// about it is right except the algorithm, and a key for that algorithm is available — so the
    /// <c>ValidAlgorithms</c> pin is the only thing that can refuse it.
    ///
    /// <para>Verified to bite: with that line removed this test fails and the one above does not,
    /// which is how the two were told apart in the first place.</para>
    /// </summary>
    [Fact]
    public async Task Refuses_a_token_signed_with_an_algorithm_the_api_did_not_pin()
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();

        HttpResponseMessage response = await GetMeAsync(
            factory, _tokens.MintWithUnpinnedAlgorithm(subject: "administrator"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>A correctly formed RS256 token from a keypair this API was never told about.</summary>
    [Fact]
    public async Task Refuses_a_token_signed_by_a_different_key()
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();
        using RSA someoneElse = TestTokens.SomeoneElsesKey();

        HttpResponseMessage response = await GetMeAsync(factory, _tokens.Mint(signedWith: someoneElse));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// Signed by the right key, for the right audience, and issued by somebody else. Without
    /// <c>ValidateIssuer</c> this is accepted, and any system sharing an issuer's infrastructure can
    /// mint credentials for this one.
    /// </summary>
    [Fact]
    public async Task Refuses_a_token_from_another_issuer()
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();

        HttpResponseMessage response = await GetMeAsync(
            factory, _tokens.Mint(issuer: "https://somewhere-else.test"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// Signed by the right key, from the right issuer, and meant for a different service. This is the
    /// one people leave off, and it is what stops a token minted for an unrelated API in the same
    /// estate from working here.
    /// </summary>
    [Fact]
    public async Task Refuses_a_token_for_another_audience()
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();

        HttpResponseMessage response = await GetMeAsync(
            factory, _tokens.Mint(audience: "some-other-api"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// Expired two minutes ago — chosen deliberately, not arbitrarily.
    ///
    /// <para>The framework's default <c>ClockSkew</c> is five minutes, so a token two minutes past
    /// its expiry is still accepted under the defaults and refused under the thirty seconds this API
    /// configures. The test therefore fails if that line is ever removed, which a token expired an
    /// hour ago would not.</para>
    /// </summary>
    [Fact]
    public async Task Refuses_a_token_that_expired_within_the_default_clock_skew()
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();

        HttpResponseMessage response = await GetMeAsync(
            factory, _tokens.Mint(expiresIn: TimeSpan.FromMinutes(-2)));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// A valid token with one character of its payload changed. The signature no longer matches what
    /// it covers, which is the entire point of signing it.
    /// </summary>
    [Fact]
    public async Task Refuses_a_token_whose_payload_was_edited()
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();

        string[] parts = _tokens.Mint(subject: "user-1").Split('.');
        parts[1] = parts[1][..^1] + (parts[1][^1] == 'A' ? 'B' : 'A');

        HttpResponseMessage response = await GetMeAsync(factory, string.Join('.', parts));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Refuses_a_request_with_no_token_at_all()
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();

        HttpResponseMessage response = await GetMeAsync(factory, token: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Refuses_something_that_is_not_a_token()
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();

        HttpResponseMessage response = await GetMeAsync(factory, "not-a-jwt");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---------------------------------------------------------------------------------------------
    // The public map, which is the decision this milestone made first
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// The establishment endpoints take no token and must never start needing one.
    ///
    /// <para>This is the milestone's central product decision defended by a test rather than by a
    /// paragraph: the URL goes on a résumé, and anything between a hiring manager and a working map
    /// is a reason to close the tab. Adding a global authorization fallback policy — a normal thing
    /// to reach for once auth exists — would break this and nothing else.</para>
    /// </summary>
    [Theory]
    [InlineData("/api/v1/establishments?pageSize=1")]
    [InlineData("/api/v1/establishments/map?minLat=40.700&maxLat=40.775&minLon=-74.020&maxLon=-73.960")]
    public async Task Leaves_the_establishment_endpoints_anonymous(string url)
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();

        HttpResponseMessage response = await factory.CreateClient().GetAsync(url);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Leaves_the_establishment_detail_endpoint_anonymous()
    {
        using FreshlineApiFactory factory = ConfiguredForTestIssuer();

        HttpResponseMessage response = await factory.CreateClient()
            .GetAsync($"/api/v1/establishments/{fixture.Seeded.InspectedTwiceId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ---------------------------------------------------------------------------------------------
    // The unconfigured deployment
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// With no public key configured, the API still starts and still serves the public map, and the
    /// authenticated endpoint refuses everyone.
    ///
    /// <para>That combination is deliberate. Refusing to start without an RSA keypair would make this
    /// milestone's acceptance criterion — a stranger exploring a working map — depend on a credential
    /// the map does not use. Accepting tokens without being able to check them would be catastrophic.
    /// Serving the anonymous half and refusing the authenticated half is the only answer that is both
    /// safe and useful, and the shared <see cref="ApiFixture"/> host configures no key, so this runs
    /// against exactly that state.</para>
    /// </summary>
    [Fact]
    public async Task Serves_the_public_endpoints_and_refuses_tokens_when_no_key_is_configured()
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage anonymous = await client.GetAsync("/api/v1/establishments?pageSize=1");
        Assert.Equal(HttpStatusCode.OK, anonymous.StatusCode);

        HttpRequestMessage authenticated = new(HttpMethod.Get, "/api/v1/me");
        authenticated.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _tokens.Mint());

        HttpResponseMessage refused = await client.SendAsync(authenticated);
        Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);
    }

    /// <summary>
    /// Configuring a key that is not a key is a startup failure, not a runtime surprise.
    ///
    /// <para>The two unconfigured-versus-misconfigured cases are opposites on purpose. No key means
    /// this deployment does not intend to accept tokens, so it starts. A malformed key means it does
    /// intend to and cannot, and starting anyway would produce an API that looks authenticated and
    /// rejects every caller — a fault discovered by a user rather than by a deploy.</para>
    /// </summary>
    [Fact]
    public void Refuses_to_start_when_the_configured_key_is_not_a_key()
    {
        using FreshlineApiFactory factory = new(
            fixture.ConnectionString,
            new Dictionary<string, string> { ["Jwt:PublicKeyPem"] = "clearly not a PEM key" });

        InvalidOperationException failure =
            Assert.Throws<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains("Jwt:PublicKeyPem", failure.Message, StringComparison.Ordinal);
    }
}
