using System.Net.Http.Json;
using System.Text.Json;

namespace Freshline.Api.Tests;

/// <summary>
/// The OpenAPI document, checked against what the API actually enforces.
///
/// <para>This milestone is done when a stranger can explore live documentation and every endpoint is
/// correct, which makes the document a deliverable rather than a by-product. These assertions exist
/// because the failure mode is silent in both directions: a document that omits an auth requirement
/// and one that invents one both generate cleanly, serve a 200, and render a perfectly convincing
/// page.</para>
/// </summary>
[Collection(ApiCollection.Name)]
public class OpenApiDocumentTests(ApiFixture fixture)
{
    private async Task<JsonElement> GetDocumentAsync()
        => await fixture.CreateClient().GetFromJsonAsync<JsonElement>("/openapi/v1.json");

    /// <summary>
    /// The document declares bearer authentication.
    ///
    /// <para><c>AddOpenApi</c> does not infer this from registered authentication — the first
    /// generated document had no <c>securitySchemes</c> at all, which was found by reading it rather
    /// than by any test failing. Without the scheme, Scalar renders no way to enter a token, so the
    /// one endpoint that needs one cannot be tried from the documentation this milestone is measured
    /// by.</para>
    /// </summary>
    [Fact]
    public async Task Declares_the_bearer_security_scheme()
    {
        JsonElement document = await GetDocumentAsync();

        JsonElement scheme = document
            .GetProperty("components").GetProperty("securitySchemes").GetProperty("Bearer");

        Assert.Equal("http", scheme.GetProperty("type").GetString());
        Assert.Equal("bearer", scheme.GetProperty("scheme").GetString());
    }

    [Fact]
    public async Task Marks_the_identity_endpoint_as_requiring_a_token()
    {
        JsonElement document = await GetDocumentAsync();

        JsonElement security = document
            .GetProperty("paths").GetProperty("/api/v1/me").GetProperty("get")
            .GetProperty("security");

        Assert.Contains(
            security.EnumerateArray(),
            requirement => requirement.TryGetProperty("Bearer", out _));
    }

    /// <summary>
    /// The other half, and the more important one. A document-level security block would have been
    /// the quicker way to describe <c>/me</c>, and it would also have described the public map as
    /// needing a token.
    ///
    /// <para>That is not a cosmetic error. The map being anonymous is this milestone's central
    /// product decision — the URL goes on a résumé, and a hiring manager who reads "requires
    /// authentication" against the main endpoint has already been told the wrong thing about the
    /// project. Documentation that overstates a requirement is as wrong as documentation that
    /// hides one.</para>
    /// </summary>
    [Theory]
    [InlineData("/api/v1/establishments")]
    [InlineData("/api/v1/establishments/map")]
    [InlineData("/api/v1/establishments/{id}")]
    public async Task Does_not_mark_the_public_endpoints_as_requiring_a_token(string path)
    {
        JsonElement document = await GetDocumentAsync();

        JsonElement operation = document.GetProperty("paths").GetProperty(path).GetProperty("get");

        Assert.False(
            operation.TryGetProperty("security", out JsonElement security)
                && security.GetArrayLength() > 0,
            $"{path} is anonymous by design and the document must not claim otherwise.");
    }

    /// <summary>
    /// Every endpoint that can be throttled says so. A 429 only appears under load, which is exactly
    /// the response a client author will not have handled unless the document told them it existed.
    /// </summary>
    [Theory]
    [InlineData("/api/v1/establishments")]
    [InlineData("/api/v1/establishments/map")]
    [InlineData("/api/v1/establishments/{id}")]
    [InlineData("/api/v1/me")]
    public async Task Documents_the_throttled_response(string path)
    {
        JsonElement document = await GetDocumentAsync();

        JsonElement responses = document
            .GetProperty("paths").GetProperty(path).GetProperty("get").GetProperty("responses");

        Assert.True(
            responses.TryGetProperty("429", out _),
            $"{path} is behind the rate limiter and the document should say a 429 is possible.");
    }
}
