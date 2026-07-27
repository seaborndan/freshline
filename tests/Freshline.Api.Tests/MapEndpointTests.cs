using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Freshline.Core.Queries;

namespace Freshline.Api.Tests;

/// <summary>
/// The map viewport endpoint. Every fixture establishment with coordinates sits inside
/// <see cref="WholeFixture"/>, which is the same box the M3 measurements used.
/// </summary>
[Collection(ApiCollection.Name)]
public class MapEndpointTests(ApiFixture fixture)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>The M3 viewport: lower and midtown Manhattan plus part of Brooklyn.</summary>
    private const string WholeFixture = "minLat=40.700&maxLat=40.775&minLon=-74.020&maxLon=-73.960";

    /// <summary>Tight enough to contain only FIXTURE DINER, at 40.7200, -74.0010.</summary>
    private const string DinerOnly = "minLat=40.7198&maxLat=40.7202&minLon=-74.0012&maxLon=-74.0008";

    private sealed record MapResponse(IReadOnlyList<MapEstablishment> Items, bool IsTruncated);

    private async Task<MapResponse> GetMapAsync(string query)
    {
        HttpClient client = fixture.CreateClient();
        return (await client.GetFromJsonAsync<MapResponse>(
            $"/api/v1/establishments/map?{query}", JsonOptions))!;
    }

    private async Task<HttpResponseMessage> GetRawAsync(string query)
    {
        HttpClient client = fixture.CreateClient();
        return await client.GetAsync($"/api/v1/establishments/map?{query}");
    }

    /// <summary>
    /// Five of the six fixture establishments have coordinates. The sixth cannot be drawn on a map
    /// and so is not on it — but it is still reachable through the list and detail endpoints, which
    /// is the distinction this test pins down.
    /// </summary>
    [Fact]
    public async Task Returns_only_establishments_that_have_coordinates()
    {
        MapResponse map = await GetMapAsync($"{WholeFixture}&limit=100");

        Assert.Equal(5, map.Items.Count);
        Assert.DoesNotContain(map.Items, item => item.Id == fixture.Seeded.WithoutCoordinatesId);
        Assert.All(map.Items, item => Assert.NotEqual(0, item.Latitude));
        Assert.All(map.Items, item => Assert.NotEqual(0, item.Longitude));
    }

    /// <summary>
    /// The whole point of the slice. A never-inspected establishment is a pin on the map with no
    /// grade, not an absent pin. An inner join deletes it and nothing about the response looks wrong.
    /// </summary>
    [Fact]
    public async Task Includes_a_never_inspected_establishment_as_a_pin_with_no_grade()
    {
        MapResponse map = await GetMapAsync($"{WholeFixture}&limit=100");

        MapEstablishment pin =
            Assert.Single(map.Items, item => item.Id == fixture.Seeded.NeverInspectedId);

        Assert.True(pin.IsAwaitingFirstInspection);
        Assert.Null(pin.LatestInspection);
    }

    [Fact]
    public async Task Carries_the_latest_inspection_for_an_inspected_establishment()
    {
        MapResponse map = await GetMapAsync($"{WholeFixture}&limit=100");

        MapEstablishment pin =
            Assert.Single(map.Items, item => item.Id == fixture.Seeded.InspectedTwiceId);

        Assert.NotNull(pin.LatestInspection);
        Assert.Equal(new DateOnly(2026, 6, 1), pin.LatestInspection.InspectedOn);
        Assert.Equal(Core.Model.InspectionOutcome.Good, pin.LatestInspection.Outcome);
    }

    [Fact]
    public async Task Excludes_establishments_outside_the_viewport()
    {
        MapResponse map = await GetMapAsync($"{DinerOnly}&limit=100");

        MapEstablishment pin = Assert.Single(map.Items);

        Assert.Equal(fixture.Seeded.InspectedTwiceId, pin.Id);
        Assert.False(map.IsTruncated);
    }

    /// <summary>
    /// The bounds are inclusive, so an establishment sitting exactly on a viewport edge appears in
    /// both of two adjacent viewports rather than in neither. A pin duplicated at a seam is
    /// cosmetic; a pin missing at a seam is a hole in the map that only shows up at one zoom level.
    /// </summary>
    [Fact]
    public async Task Includes_an_establishment_exactly_on_the_viewport_boundary()
    {
        MapResponse map = await GetMapAsync(
            "minLat=40.7200&maxLat=40.7300&minLon=-74.0010&maxLon=-73.9900&limit=100");

        Assert.Contains(map.Items, item => item.Id == fixture.Seeded.InspectedTwiceId);
    }

    [Fact]
    public async Task Reports_truncation_when_the_viewport_holds_more_than_the_limit()
    {
        MapResponse truncated = await GetMapAsync($"{WholeFixture}&limit=2");

        Assert.Equal(2, truncated.Items.Count);
        Assert.True(truncated.IsTruncated);

        // Exactly as many as exist is not truncation, which is the case an implementation that
        // compares "did I fill the limit" gets wrong.
        MapResponse exact = await GetMapAsync($"{WholeFixture}&limit=5");

        Assert.Equal(5, exact.Items.Count);
        Assert.False(exact.IsTruncated);
    }

    [Fact]
    public async Task Applies_the_same_filters_as_the_list()
    {
        MapResponse awaiting = await GetMapAsync($"{WholeFixture}&awaitingFirstInspection=true&limit=100");

        Assert.All(awaiting.Items, item => Assert.True(item.IsAwaitingFirstInspection));
        Assert.All(awaiting.Items, item => Assert.Null(item.LatestInspection));

        MapResponse irish = await GetMapAsync($"{WholeFixture}&cuisine=Irish&limit=100");

        Assert.Single(irish.Items, item => item.Id == fixture.Seeded.AwkwardNameId);
    }

    [Fact]
    public async Task Reads_a_viewport_in_a_single_query()
    {
        fixture.Commands.Reset();

        HttpResponseMessage response = await GetRawAsync($"{WholeFixture}&limit=100");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, fixture.Commands.Count);
    }

    /// <summary>
    /// A missing bound is an error, not a default. Defaulting to zero would put the viewport in the
    /// Gulf of Guinea and return an empty map — indistinguishable, to the caller, from a part of the
    /// city with no restaurants in it.
    /// </summary>
    [Theory]
    [InlineData("maxLat=40.775&minLon=-74.020&maxLon=-73.960", "Incomplete viewport")]
    [InlineData("minLat=40.700&minLon=-74.020&maxLon=-73.960", "Incomplete viewport")]
    [InlineData("", "Incomplete viewport")]
    // Swapped min and max — the most likely caller mistake, and one that otherwise returns an
    // empty map rather than an error.
    [InlineData("minLat=40.775&maxLat=40.700&minLon=-74.020&maxLon=-73.960", "Inverted viewport")]
    [InlineData("minLat=40.700&maxLat=40.775&minLon=-73.960&maxLon=-74.020", "Inverted viewport")]
    [InlineData("minLat=-91&maxLat=40.775&minLon=-74.020&maxLon=-73.960", "Viewport outside the world")]
    [InlineData("minLat=40.700&maxLat=40.775&minLon=-74.020&maxLon=181", "Viewport outside the world")]
    // Wider than the entire dataset, which spans 0.41 by 0.55 degrees.
    [InlineData("minLat=39&maxLat=41&minLon=-74.020&maxLon=-73.960", "Viewport too large")]
    [InlineData("minLat=40.700&maxLat=40.775&minLon=-75&maxLon=-73", "Viewport too large")]
    public async Task Rejects_an_invalid_viewport(string query, string expectedTitle)
    {
        HttpResponseMessage response = await GetRawAsync(query);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        JsonElement problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(expectedTitle, problem.GetProperty("title").GetString());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(5001)]
    public async Task Rejects_a_limit_outside_the_allowed_range(int limit)
    {
        HttpResponseMessage response = await GetRawAsync($"{WholeFixture}&limit={limit}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        JsonElement problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Invalid limit", problem.GetProperty("title").GetString());
    }

    /// <summary>
    /// <c>/map</c> is a literal segment and <c>/{id:int}</c> is a constrained parameter. Routing
    /// scores the literal higher, so the two cannot collide — but that is a fact about ASP.NET Core
    /// routing rather than about this code, so it is worth an assertion rather than an assumption.
    /// </summary>
    [Fact]
    public async Task Does_not_collide_with_the_detail_route()
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage detail =
            await client.GetAsync($"/api/v1/establishments/{fixture.Seeded.InspectedTwiceId}");

        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);

        HttpResponseMessage map = await GetRawAsync($"{WholeFixture}&limit=1");

        Assert.Equal(HttpStatusCode.OK, map.StatusCode);
    }
}
