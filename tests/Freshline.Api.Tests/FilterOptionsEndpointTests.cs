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
