using System.Net;

namespace Freshline.Api.Tests;

/// <summary>
/// Starts the real API host in memory and calls it over HTTP. The assertions are thin; the test is
/// not. It fails if dependency injection is misconfigured, if the host cannot start, or if the
/// pipeline is wired wrongly — which is precisely the class of breakage a unit test sails past.
/// </summary>
[Collection(ApiCollection.Name)]
public class HealthEndpointTests(ApiFixture fixture)
{
    /// <summary>
    /// Liveness runs no checks. It answers "is this process up", and it must keep answering that
    /// even when a dependency is down, because the reaction to a failed liveness probe is a restart
    /// and restarting the API cannot fix an unreachable database.
    /// </summary>
    [Fact]
    public async Task Liveness_reports_healthy()
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// Readiness does reach the database. With SQL Server running — which these tests require —
    /// it reports healthy. The value of the check is the case this test cannot easily produce:
    /// when the database is unreachable it reports unhealthy, so a load balancer stops sending
    /// this instance traffic instead of restarting it.
    /// </summary>
    [Fact]
    public async Task Readiness_reports_healthy_when_the_database_is_reachable()
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage response = await client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }
}
