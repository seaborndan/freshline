using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Freshline.Core.Queries;

namespace Freshline.Api.Tests;

/// <summary>
/// The list endpoint, exercised over HTTP against a real database.
///
/// <para>The cursor codec is deliberately not unit tested directly. It is internal, and reaching it
/// would mean opening the API's internals to the test project to assert on a base64 round trip that
/// the paging tests already cover end to end — including the case that actually matters, a name full
/// of characters that would break a naive encoding. Testing it through the endpoint proves the thing
/// callers depend on rather than the thing the implementation happens to do.</para>
/// </summary>
[Collection(ApiCollection.Name)]
public class EstablishmentListEndpointTests(ApiFixture fixture)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private sealed record ListResponse(IReadOnlyList<EstablishmentSummary> Items, string? NextCursor);

    private async Task<ListResponse> GetPageAsync(string query)
    {
        HttpClient client = fixture.CreateClient();
        return (await client.GetFromJsonAsync<ListResponse>(
            $"/api/v1/establishments{query}", JsonOptions))!;
    }

    /// <summary>
    /// Ordering is decided by the database collation, not by .NET, so this compares against an
    /// ordinal sort only because the two agree on the fixture's names. It would be wrong to read
    /// this as a claim that SQL Server's collation and <c>StringComparer.Ordinal</c> agree in
    /// general — they do not, on case and on accents. The property that actually matters, that a
    /// walk visits every row exactly once, is asserted separately and does not depend on this.
    /// </summary>
    [Fact]
    public async Task Returns_establishments_ordered_by_name()
    {
        ListResponse page = await GetPageAsync("?pageSize=100");

        List<string> names = page.Items.Select(item => item.Name).ToList();

        Assert.Equal(names.OrderBy(name => name, StringComparer.Ordinal), names);
    }

    /// <summary>
    /// The property the whole design exists for: paging through the list returns every row exactly
    /// once. A cursor that sorted on name alone would skip or repeat rows wherever two
    /// establishments share a name, and the fixture seeds two that do.
    /// </summary>
    [Fact]
    public async Task Paging_returns_every_establishment_exactly_once()
    {
        List<int> seen = [];
        string? cursor = null;
        int pages = 0;

        do
        {
            ListResponse page = await GetPageAsync(
                cursor is null ? "?pageSize=2" : $"?pageSize=2&cursor={Uri.EscapeDataString(cursor)}");

            seen.AddRange(page.Items.Select(item => item.Id));
            cursor = page.NextCursor;
            pages++;
        }
        // A bound, so a cursor bug that fails to advance fails the test rather than hanging CI.
        while (cursor is not null && pages < 20);

        Assert.Null(cursor);
        Assert.Equal(fixture.Seeded.TotalEstablishments, seen.Count);
        Assert.Equal(fixture.Seeded.TotalEstablishments, seen.Distinct().Count());
    }

    /// <summary>
    /// Two establishments share a name here. Both must come back, in id order — that is the
    /// tiebreaker doing its job, and it is the case a name-only cursor gets wrong.
    /// </summary>
    [Fact]
    public async Task Returns_both_establishments_that_share_a_name_in_id_order()
    {
        ListResponse page = await GetPageAsync("?nameStartsWith=FIXTURE SHARED NAME&pageSize=10");

        Assert.Equal(
            [fixture.Seeded.SharedNameFirstId, fixture.Seeded.SharedNameSecondId],
            page.Items.Select(item => item.Id));
    }

    /// <summary>
    /// The cursor is opaque so that a name containing a colon — the codec's own separator — plus an
    /// apostrophe, an ampersand and a plus cannot corrupt it.
    ///
    /// <para>Walking one row at a time is what makes this a real test: every row's cursor is built
    /// and then used, so the awkward name is necessarily encoded into a cursor and decoded again. A
    /// codec that mangled it would stall the walk, repeat a row, or return a 400 — all of which fail
    /// here rather than passing quietly.</para>
    /// </summary>
    [Fact]
    public async Task Pages_correctly_across_a_name_containing_punctuation()
    {
        List<EstablishmentSummary> walked = [];
        string? cursor = null;
        int pages = 0;

        do
        {
            ListResponse page = await GetPageAsync(
                cursor is null ? "?pageSize=1" : $"?pageSize=1&cursor={Uri.EscapeDataString(cursor)}");

            walked.AddRange(page.Items);
            cursor = page.NextCursor;
            pages++;
        }
        while (cursor is not null && pages < 20);

        Assert.Equal(fixture.Seeded.TotalEstablishments, walked.Count);
        Assert.Equal(fixture.Seeded.TotalEstablishments, walked.Select(item => item.Id).Distinct().Count());

        EstablishmentSummary awkward =
            Assert.Single(walked, item => item.Id == fixture.Seeded.AwkwardNameId);

        Assert.Equal("FIXTURE O'BRIEN: BAR & GRILL + CAFE", awkward.Name);

        // It must not be the last row, or its cursor was never used to fetch anything.
        Assert.NotEqual(walked[^1].Id, awkward.Id);
    }

    /// <summary>
    /// The correction this slice exists to make. The latest-inspection lookup is a left join, so an
    /// establishment that has never been inspected stays in the list with a null latestInspection.
    /// An inner join drops it — silently, while still returning rows and still looking correct.
    /// </summary>
    [Fact]
    public async Task Includes_a_never_inspected_establishment_with_no_latest_inspection()
    {
        ListResponse page = await GetPageAsync("?pageSize=100");

        EstablishmentSummary neverInspected =
            page.Items.Single(item => item.Id == fixture.Seeded.NeverInspectedId);

        Assert.True(neverInspected.IsAwaitingFirstInspection);
        Assert.Null(neverInspected.LatestInspection);
    }

    [Fact]
    public async Task Carries_the_most_recent_inspection_on_an_inspected_establishment()
    {
        ListResponse page = await GetPageAsync("?pageSize=100");

        EstablishmentSummary diner =
            page.Items.Single(item => item.Id == fixture.Seeded.InspectedTwiceId);

        Assert.NotNull(diner.LatestInspection);
        Assert.Equal(new DateOnly(2026, 6, 1), diner.LatestInspection.InspectedOn);
        Assert.Equal("A", diner.LatestInspection.RawGrade);
        Assert.Equal(Core.Model.InspectionOutcome.Good, diner.LatestInspection.Outcome);
    }

    /// <summary>
    /// The outcome filter matches the <em>latest</em> inspection, not any inspection in the history.
    /// FIXTURE DINER's older inspection is Ungraded and its newer one is Good, so it must appear
    /// under Good and must not appear under Ungraded. An Any() implementation passes the first
    /// assertion and fails the second, which is the whole reason the second one is here.
    /// </summary>
    [Fact]
    public async Task Filters_on_the_latest_outcome_rather_than_any_past_outcome()
    {
        ListResponse good = await GetPageAsync("?outcome=Good&pageSize=100");
        Assert.Contains(good.Items, item => item.Id == fixture.Seeded.InspectedTwiceId);

        ListResponse ungraded = await GetPageAsync("?outcome=Ungraded&pageSize=100");
        Assert.DoesNotContain(ungraded.Items, item => item.Id == fixture.Seeded.InspectedTwiceId);
    }

    [Fact]
    public async Task Filters_to_establishments_awaiting_a_first_inspection()
    {
        ListResponse page = await GetPageAsync("?awaitingFirstInspection=true&pageSize=100");

        Assert.All(page.Items, item => Assert.True(item.IsAwaitingFirstInspection));
        Assert.All(page.Items, item => Assert.Null(item.LatestInspection));
        Assert.Contains(page.Items, item => item.Id == fixture.Seeded.NeverInspectedId);
    }

    [Fact]
    public async Task Filters_by_cuisine_and_by_locality()
    {
        ListResponse byCuisine = await GetPageAsync("?cuisine=Irish&pageSize=100");
        Assert.All(byCuisine.Items, item => Assert.Equal("Irish", item.Cuisine));

        ListResponse byLocality = await GetPageAsync("?locality=Manhattan&pageSize=100");
        Assert.All(byLocality.Items, item => Assert.Equal("Manhattan", item.Locality));
        Assert.Contains(byLocality.Items, item => item.Id == fixture.Seeded.InspectedTwiceId);
    }

    [Fact]
    public async Task The_last_page_has_no_next_cursor()
    {
        ListResponse page = await GetPageAsync("?pageSize=100");

        Assert.Equal(fixture.Seeded.TotalEstablishments, page.Items.Count);

        // Exactly the case a "the page came back full, so assume there is more" implementation gets
        // wrong: ask for precisely as many rows as exist and there is still no next page.
        ListResponse exact = await GetPageAsync($"?pageSize={fixture.Seeded.TotalEstablishments}");

        Assert.Equal(fixture.Seeded.TotalEstablishments, exact.Items.Count);
        Assert.Null(exact.NextCursor);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(201)]
    public async Task Rejects_a_page_size_outside_the_allowed_range(int pageSize)
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage response =
            await client.GetAsync($"/api/v1/establishments?pageSize={pageSize}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        JsonElement problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Invalid page size", problem.GetProperty("title").GetString());
    }

    /// <summary>
    /// A malformed cursor is a 400, not an empty page. Returning an empty page would make a client's
    /// paging bug look exactly like the end of the data.
    /// </summary>
    [Theory]
    [InlineData("not-base64!!")]
    [InlineData("bm90LWEtY3Vyc29y")]  // valid base64url, decodes to "not-a-cursor" — no id, no colon
    [InlineData("OmVtcHR5LWlk")]      // decodes to ":empty-id" — colon first, so no id at all
    public async Task Rejects_a_cursor_it_did_not_issue(string cursor)
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage response = await client.GetAsync(
            $"/api/v1/establishments?cursor={Uri.EscapeDataString(cursor)}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        JsonElement problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Invalid cursor", problem.GetProperty("title").GetString());
    }

    /// <summary>
    /// An unknown outcome fails parameter binding before the handler runs. It still has to come back
    /// as ProblemDetails rather than as a bare 400 with an empty body.
    /// </summary>
    [Fact]
    public async Task Returns_problem_details_for_an_outcome_that_is_not_a_known_value()
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage response =
            await client.GetAsync("/api/v1/establishments?outcome=Delicious");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }
}
