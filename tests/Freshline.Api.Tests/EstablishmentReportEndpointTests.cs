using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Freshline.Core.Queries;

namespace Freshline.Api.Tests;

/// <summary>
/// The row-level report: which establishments, rather than how results distribute.
///
/// <para>The property worth defending here is that a filtered list still describes the population it
/// claims to. Dropping establishments with no inspection in the selected period would quietly turn a
/// list of establishments into a list of inspections — a table that looks complete and is not.</para>
/// </summary>
[Collection(ApiCollection.Name)]
public class EstablishmentReportEndpointTests(ApiFixture fixture)
{
    private const string Url = "/api/v1/reports/establishments";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private async Task<EstablishmentReport> GetAsync(string query = "")
        => (await fixture.CreateClient()
            .GetFromJsonAsync<EstablishmentReport>($"{Url}{query}", JsonOptions))!;

    [Fact]
    public async Task Returns_establishments_with_their_latest_result()
    {
        EstablishmentReport report = await GetAsync();

        EstablishmentReportRow diner = Assert.Single(report.Rows, row => row.Name == "FIXTURE DINER");

        Assert.Equal("Manhattan", diner.Locality);
        Assert.Equal("American", diner.Cuisine);
        Assert.Equal("1 FIXTURE STREET", diner.AddressLine);

        // The latest of its two inspections, not the older one.
        Assert.Equal(new DateOnly(2026, 6, 1), diner.InspectedOn);
        Assert.False(diner.IsAwaitingFirstInspection);
    }

    /// <summary>
    /// A never-inspected establishment is listed, with a null result rather than being omitted. It is
    /// a published state, and 3,605 of them exist — a report that dropped them would describe a
    /// different city.
    /// </summary>
    [Fact]
    public async Task Lists_a_never_inspected_establishment_with_no_result()
    {
        EstablishmentReport report = await GetAsync();

        EstablishmentReportRow row = Assert.Single(
            report.Rows, entry => entry.Name == "FIXTURE NEWLY PERMITTED");

        Assert.True(row.IsAwaitingFirstInspection);
        Assert.Null(row.Outcome);
        Assert.Null(row.InspectedOn);
        Assert.False(row.ClosedByAuthority);
    }

    /// <summary>
    /// The semantic decision, at row level: a date range narrows which inspections count, so the
    /// reported result is the latest one inside the period.
    /// </summary>
    [Fact]
    public async Task Reports_the_latest_result_inside_the_period()
    {
        EstablishmentReport report = await GetAsync("?inspectedFrom=2025-01-01&inspectedTo=2025-12-31");

        EstablishmentReportRow diner = Assert.Single(report.Rows, row => row.Name == "FIXTURE DINER");

        Assert.Equal(new DateOnly(2025, 11, 14), diner.InspectedOn);
        Assert.True(report.HasDateRange);
    }

    /// <summary>
    /// And it is still listed when nothing falls inside the period — with a null result.
    ///
    /// <para>This is the difference between "which establishments are in this borough" and "which
    /// inspections happened in this window". The report claims to answer the first.</para>
    /// </summary>
    [Fact]
    public async Task Still_lists_an_establishment_with_no_inspection_in_the_period()
    {
        EstablishmentReport report = await GetAsync("?inspectedFrom=2020-01-01&inspectedTo=2020-12-31");

        EstablishmentReportRow diner = Assert.Single(report.Rows, row => row.Name == "FIXTURE DINER");

        Assert.Null(report.Rows.Single(row => row.Name == "FIXTURE DINER").Outcome);
        Assert.Null(diner.InspectedOn);

        // Distinguishable from the genuinely never-inspected one, which is the point of keeping the
        // flag on the row rather than inferring "no data" from a null outcome.
        Assert.False(diner.IsAwaitingFirstInspection);
    }

    [Fact]
    public async Task Filters_by_borough()
    {
        EstablishmentReport report = await GetAsync("?locality=Manhattan");

        Assert.NotEmpty(report.Rows);
        Assert.All(report.Rows, row => Assert.Equal("Manhattan", row.Locality));
    }

    /// <summary>
    /// A contradiction the caller is allowed to express, answered honestly with nothing: an
    /// establishment with no inspections has no outcome to match.
    /// </summary>
    [Fact]
    public async Task Returns_nothing_for_an_outcome_combined_with_never_inspected()
    {
        EstablishmentReport report = await GetAsync("?outcome=Good&awaitingFirstInspection=true");

        Assert.Empty(report.Rows);
    }

    /// <summary>
    /// The cap is observed rather than inferred — the query takes one row more than the limit, so a
    /// page that is exactly full is distinguishable from one that is exactly the whole answer.
    /// </summary>
    [Fact]
    public async Task Reports_truncation_when_more_matched_than_were_returned()
    {
        EstablishmentReport limited = await GetAsync("?limit=1");

        Assert.Single(limited.Rows);
        Assert.True(limited.IsTruncated);

        EstablishmentReport whole = await GetAsync();

        Assert.False(whole.IsTruncated);
    }

    /// <summary>
    /// A limit above the cap is clamped rather than refused: it is a caller asking for more than this
    /// endpoint gives, and the honest answer is the cap plus <c>isTruncated</c> — not a 400 quoting a
    /// number they had no way to know.
    /// </summary>
    [Fact]
    public async Task Clamps_an_oversized_limit_instead_of_refusing_it()
    {
        HttpResponseMessage response = await fixture.CreateClient().GetAsync($"{Url}?limit=99999");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Refuses_a_date_range_that_runs_backwards()
    {
        HttpResponseMessage response = await fixture.CreateClient()
            .GetAsync($"{Url}?inspectedFrom=2026-01-01&inspectedTo=2025-01-01");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    /// <summary>
    /// Ordered by name then id — a total order, so which rows survive truncation does not depend on
    /// the query plan. Without it the same report run twice could return different establishments.
    /// </summary>
    [Fact]
    public async Task Orders_rows_so_truncation_is_repeatable()
    {
        EstablishmentReport first = await GetAsync("?limit=3");
        EstablishmentReport second = await GetAsync("?limit=3");

        Assert.Equal(
            first.Rows.Select(row => row.Id),
            second.Rows.Select(row => row.Id));
    }

    /// <summary>Public, like every other read endpoint — ADR-0005.</summary>
    [Fact]
    public async Task Answers_without_a_token()
    {
        HttpResponseMessage response = await fixture.CreateClient().GetAsync(Url);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
