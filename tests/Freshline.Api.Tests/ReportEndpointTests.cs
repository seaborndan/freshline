using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Freshline.Core.Queries;

namespace Freshline.Api.Tests;

/// <summary>
/// The report endpoint over HTTP — the shape of the response and the rules it enforces at the edge.
///
/// <para>The aggregation itself is covered in <c>OutcomeBreakdownQueryTests</c>. What is tested here
/// is what only exists at this layer: parameter handling, the refusal of a reversed date range, and
/// the separate rate-limit budget.</para>
/// </summary>
[Collection(ApiCollection.Name)]
public class ReportEndpointTests(ApiFixture fixture)
{
    private const string Url = "/api/v1/reports/outcome-breakdown";

    // The API writes enums as names — Program.cs registers JsonStringEnumConverter, so that
    // `dimension` reads "Locality" rather than 0. A client that does not do the same cannot read the
    // response, which is exactly what the first run of these tests demonstrated.
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    [Fact]
    public async Task Groups_by_locality_when_no_dimension_is_asked_for()
    {
        OutcomeBreakdown breakdown =
            (await fixture.CreateClient().GetFromJsonAsync<OutcomeBreakdown>(Url, JsonOptions))!;

        Assert.Equal(ReportDimension.Locality, breakdown.Dimension);
        Assert.Contains(breakdown.Rows, row => row.Group == "Manhattan");
    }

    [Fact]
    public async Task Groups_by_cuisine_when_asked()
    {
        OutcomeBreakdown breakdown = (await fixture.CreateClient()
            .GetFromJsonAsync<OutcomeBreakdown>($"{Url}?dimension=Cuisine", JsonOptions))!;

        Assert.Equal(ReportDimension.Cuisine, breakdown.Dimension);
        Assert.Contains(breakdown.Rows, row => row.Group == "American");
    }

    /// <summary>
    /// A reversed range is refused rather than quietly reordered.
    ///
    /// <para>Swapping it would return a report for a period the caller did not ask for, and the
    /// response does not echo the range back — so there would be no way to notice. This API refuses
    /// invalid input rather than guessing at intent, the same stance it takes on viewports.</para>
    /// </summary>
    [Fact]
    public async Task Refuses_a_date_range_that_runs_backwards()
    {
        HttpResponseMessage response = await fixture.CreateClient()
            .GetAsync($"{Url}?inspectedFrom=2026-01-01&inspectedTo=2025-01-01");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("is after", await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// A range where both ends are the same day is a single day, not an error.
    /// </summary>
    [Fact]
    public async Task Accepts_a_range_of_one_day()
    {
        HttpResponseMessage response = await fixture.CreateClient()
            .GetAsync($"{Url}?inspectedFrom=2026-06-01&inspectedTo=2026-06-01");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// The serialised shape a client depends on. Asserted against the JSON rather than a
    /// deserialised object, because a client reads names and these are part of the contract.
    /// </summary>
    [Fact]
    public async Task Carries_the_sample_size_beside_every_rate()
    {
        string json = await fixture.CreateClient().GetStringAsync(Url);

        Assert.Contains("poorShare", json);
        Assert.Contains("observed", json);
        Assert.Contains("supportedAtLeast", json);

        // The denominator travels with the rate. ADR-0007's first decision is that a percentage
        // never appears without its sample size, and a client cannot honour that if it is not sent.
        Assert.Contains("total", json);
        Assert.Contains("ungroupedEstablishments", json);
    }

    /// <summary>
    /// Public, like every other read endpoint — ADR-0005. One test per endpoint, because a global
    /// authorization fallback policy is the natural thing to add once auth exists and would silently
    /// close the whole read surface.
    /// </summary>
    [Fact]
    public async Task Answers_without_a_token()
    {
        HttpResponseMessage response = await fixture.CreateClient().GetAsync(Url);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// Reports spend their own budget, not the map's.
    ///
    /// <para>The point of the separate policy: a handful of report requests must not be able to lock
    /// somebody out of the map, and a user panning briskly must not be able to lock themselves out of
    /// the reports. The host here gives reports a bucket of two that never refills, while leaving the
    /// map's default budget alone — so exhausting one and finding the other still answering is the
    /// assertion.</para>
    /// </summary>
    [Fact]
    public async Task Spends_a_different_budget_from_the_map()
    {
        using FreshlineApiFactory factory = new(fixture.ConnectionString, new Dictionary<string, string>
        {
            ["RateLimiting:Reports:BurstSize"] = "2",
            ["RateLimiting:Reports:TokensPerPeriod"] = "1",
            ["RateLimiting:Reports:ReplenishmentPeriodSeconds"] = "3600",
        });

        HttpClient client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.GetAsync(Url)).StatusCode);

        // The map is untouched by a spent report budget.
        HttpResponseMessage map = await client.GetAsync(
            "/api/v1/establishments/map?minLat=40.71&maxLat=40.73&minLon=-74.01&maxLon=-73.99");

        Assert.Equal(HttpStatusCode.OK, map.StatusCode);
    }

    /// <summary>
    /// A 429 from a report quotes the report budget, not the map's.
    ///
    /// <para>M4 shipped a rejection message that divided the configured numbers into a per-second
    /// rate and told callers the API allowed "roughly 0 requests per second". The lesson recorded
    /// then was that a throttled caller's one need is to know what the real limit is — which a
    /// message quoting the wrong policy's numbers fails just as completely.</para>
    /// </summary>
    [Fact]
    public async Task Explains_the_report_budget_when_it_refuses()
    {
        using FreshlineApiFactory factory = new(fixture.ConnectionString, new Dictionary<string, string>
        {
            ["RateLimiting:Reports:BurstSize"] = "1",
            ["RateLimiting:Reports:TokensPerPeriod"] = "7",
            ["RateLimiting:Reports:ReplenishmentPeriodSeconds"] = "42",
        });

        HttpClient client = factory.CreateClient();

        await client.GetAsync(Url);
        HttpResponseMessage refused = await client.GetAsync(Url);

        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);

        string body = await refused.Content.ReadAsStringAsync();
        Assert.Contains("7 report requests every 42 seconds", body);
    }
}
