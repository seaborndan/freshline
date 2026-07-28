using System.Net;
using System.Net.Http.Json;
using Freshline.Core.Queries;

namespace Freshline.Api.Tests;

/// <summary>
/// The endpoint that tells a client what the cuisine and locality filters can match.
///
/// <para>It exists because a filter panel cannot discover these values: the map endpoint does not
/// carry cuisine, and the list endpoint returns one page's worth rather than the vocabulary. The
/// alternative was a hard-coded list in the front end, which is one city's source vocabulary living
/// in a UI and drifting silently the first time ingestion meets a new value.</para>
/// </summary>
[Collection(ApiCollection.Name)]
public class FilterOptionsEndpointTests(ApiFixture fixture)
{
    private async Task<EstablishmentFilterOptions> GetAsync()
        => (await fixture.CreateClient()
            .GetFromJsonAsync<EstablishmentFilterOptions>("/api/v1/establishments/filter-options"))!;

    /// <summary>
    /// The fixture seeds American, Pizza, Coffee twice, Irish, and one establishment with no cuisine
    /// at all. Distinct and sorted, that is four values.
    /// </summary>
    [Fact]
    public async Task Returns_each_cuisine_once_in_name_order()
    {
        EstablishmentFilterOptions options = await GetAsync();

        Assert.Equal(["American", "Coffee", "Irish", "Pizza"], options.Cuisines);
    }

    /// <summary>
    /// A null cuisine is not a value a caller can filter by — <c>?cuisine=</c> is an exact match
    /// against the empty string, which nothing has. Offering it would be offering a choice that
    /// always returns nothing.
    ///
    /// <para>This is not a rare case being defended against. Cuisine is null for exactly the
    /// establishments that have never been inspected — 3,605 of them in the live data, verified as
    /// an exact correspondence in both directions — so a cuisine filter always excludes all of
    /// them.</para>
    /// </summary>
    [Fact]
    public async Task Excludes_the_null_cuisine_that_no_filter_could_match()
    {
        EstablishmentFilterOptions options = await GetAsync();

        Assert.DoesNotContain(options.Cuisines, cuisine => string.IsNullOrEmpty(cuisine));
    }

    [Fact]
    public async Task Returns_each_locality_once_in_name_order()
    {
        EstablishmentFilterOptions options = await GetAsync();

        Assert.Equal(["Manhattan"], options.Localities);
    }

    /// <summary>
    /// The box a camera is pointed at when somebody filters to a borough.
    ///
    /// <para>The fixture seeds Manhattan establishments between 40.7200 and 40.7210 north, and
    /// -74.0020 and -74.0010 east. The assertion is on containment rather than on the exact numbers,
    /// so that adding a seeded establishment inside that area does not fail a test about camera
    /// framing.</para>
    /// </summary>
    [Fact]
    public async Task Returns_a_box_that_contains_the_areas_establishments()
    {
        EstablishmentFilterOptions options = await GetAsync();

        LocalityBounds manhattan = Assert.Single(options.LocalityBounds);

        Assert.Equal("Manhattan", manhattan.Locality);
        Assert.True(manhattan.MinLatitude <= 40.7200, "the box must contain the southernmost pin");
        Assert.True(manhattan.MaxLatitude >= 40.7210, "the box must contain the northernmost pin");
        Assert.True(manhattan.MinLongitude <= -74.0020, "the box must contain the westernmost pin");
        Assert.True(manhattan.MaxLongitude >= -74.0010, "the box must contain the easternmost pin");
    }

    /// <summary>
    /// A box is not a point, and a camera told to fit a degenerate one has nothing to fit.
    ///
    /// <para>This is the check that a min/max pair has not been swapped, which is the single most
    /// likely mistake in code that produces four coordinates and the one a range check cannot catch:
    /// both orderings are made of valid New York coordinates.</para>
    /// </summary>
    [Fact]
    public async Task Orders_each_bound_so_the_box_is_not_inside_out()
    {
        EstablishmentFilterOptions options = await GetAsync();

        foreach (LocalityBounds bounds in options.LocalityBounds)
        {
            Assert.True(
                bounds.MinLatitude <= bounds.MaxLatitude,
                $"{bounds.Locality}: min latitude {bounds.MinLatitude} exceeds max {bounds.MaxLatitude}");
            Assert.True(
                bounds.MinLongitude <= bounds.MaxLongitude,
                $"{bounds.Locality}: min longitude {bounds.MinLongitude} exceeds max {bounds.MaxLongitude}");
        }
    }

    /// <summary>
    /// Establishments with no coordinates cannot contribute to a box a camera is pointed at. The
    /// fixture seeds one — FIXTURE NO COORDINATES, in Manhattan — and it must not widen the box or
    /// create an entry of its own.
    /// </summary>
    [Fact]
    public async Task Ignores_establishments_that_cannot_be_drawn()
    {
        EstablishmentFilterOptions options = await GetAsync();

        Assert.All(
            options.LocalityBounds,
            bounds => Assert.Contains(bounds.Locality, options.Localities));
    }

    /// <summary>
    /// Public, like every other read endpoint. ADR-0005 makes anonymity a decision rather than an
    /// omission, and there is a test per endpoint because a global authorization fallback policy is
    /// the natural thing to add once auth exists and would silently close the map.
    /// </summary>
    [Fact]
    public async Task Answers_without_a_token()
    {
        HttpResponseMessage response = await fixture.CreateClient()
            .GetAsync("/api/v1/establishments/filter-options");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// The route is a literal segment beside <c>/{id:int}</c>. Routing scores literals above
    /// constrained parameters, so this cannot be shadowed — but the same was true of
    /// <c>/map</c> and it is worth one assertion rather than one assumption.
    /// </summary>
    [Fact]
    public async Task Is_not_shadowed_by_the_detail_route()
    {
        HttpResponseMessage response = await fixture.CreateClient()
            .GetAsync("/api/v1/establishments/filter-options");

        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("cuisines", await response.Content.ReadAsStringAsync());
    }
}
