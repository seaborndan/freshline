using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Freshline.Api.Tests;

/// <summary>
/// Starts the real API host in memory and calls it over HTTP. At this milestone the
/// assertion is thin, but the test is not: it fails if dependency injection is
/// misconfigured, if the host cannot start, or if the pipeline is wired wrongly —
/// which is precisely the class of breakage a unit test would sail past.
/// </summary>
public class HealthEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HealthEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task Health_endpoint_reports_healthy()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }
}
