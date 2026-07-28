using System.Net;
using System.Net.Http.Json;
using Freshline.Core.Queries;

namespace Freshline.Api.Tests;

/// <summary>
/// The counts the landing page states about the dataset.
///
/// <para>These exist as an endpoint rather than as constants in the front end because a hard-coded
/// figure is true on the day it is written and silently false after the next ingestion run.
/// <c>CLAUDE.md</c> says never invent a number, and a number left to drift is the slower version of
/// inventing one.</para>
/// </summary>
[Collection(ApiCollection.Name)]
public class SummaryEndpointTests(ApiFixture fixture)
{
    private async Task<DatasetSummary> GetAsync()
        => (await fixture.CreateClient()
            .GetFromJsonAsync<DatasetSummary>("/api/v1/establishments/summary"))!;

    /// <summary>
    /// Six establishments are seeded, and the count includes the one that has never been inspected
    /// and the one with no coordinates. Neither is excluded: they are establishments the city lists,
    /// which is what this number claims to count.
    /// </summary>
    [Fact]
    public async Task Counts_every_establishment_including_the_undrawable_ones()
    {
        DatasetSummary summary = await GetAsync();

        Assert.Equal(6, summary.EstablishmentCount);
    }

    /// <summary>
    /// Reported separately because it is a published state rather than an absence in our records, and
    /// because at 3,605 of 23,528 in the live data it is large enough that a reader who assumed every
    /// establishment carries a grade would misread every other number on the page.
    /// </summary>
    [Fact]
    public async Task Reports_never_inspected_establishments_as_their_own_figure()
    {
        DatasetSummary summary = await GetAsync();

        Assert.Equal(1, summary.AwaitingFirstInspectionCount);
        Assert.True(summary.AwaitingFirstInspectionCount < summary.EstablishmentCount);
    }

    [Fact]
    public async Task Counts_inspections_across_every_establishment()
    {
        DatasetSummary summary = await GetAsync();

        Assert.Equal(2, summary.InspectionCount);
    }

    /// <summary>
    /// The same values <c>/filter-options</c> lists, counted. They agree because both filter nulls
    /// before the distinct — if these two endpoints ever disagreed, one of them would be describing a
    /// vocabulary the other does not offer.
    /// </summary>
    [Fact]
    public async Task Counts_the_same_vocabulary_the_filters_offer()
    {
        DatasetSummary summary = await GetAsync();
        EstablishmentFilterOptions options = (await fixture.CreateClient()
            .GetFromJsonAsync<EstablishmentFilterOptions>("/api/v1/establishments/filter-options"))!;

        Assert.Equal(options.Cuisines.Count, summary.CuisineCount);
        Assert.Equal(options.Localities.Count, summary.LocalityCount);
    }

    /// <summary>
    /// The newest inspection is seeded at 2026-06-01 and the older one at 2025-11-14.
    ///
    /// <para>Asserted as a <see cref="DateOnly"/> rather than through a formatted string, because the
    /// bug this project has been avoiding since the map's first slice is precisely a date crossing a
    /// timezone: "2026-06-01" through a <c>DateTime</c> is UTC midnight, which is the previous day in
    /// New York.</para>
    /// </summary>
    [Fact]
    public async Task Reports_the_most_recent_inspection_date()
    {
        DatasetSummary summary = await GetAsync();

        Assert.Equal(new DateOnly(2026, 6, 1), summary.LatestInspectionOn);
    }

    /// <summary>
    /// The freshness figure is the <em>source's</em>, not ours.
    ///
    /// <para>It is the latest inspection date in the data rather than the time our ingestion last
    /// ran, so a successful run that found nothing new leaves it unchanged. That is the honest thing
    /// for a landing page to say: a freshness claim based on our own job history would report the
    /// data as current at the exact moment the source went quiet.</para>
    /// </summary>
    [Fact]
    public async Task Does_not_report_a_date_newer_than_the_data()
    {
        DatasetSummary summary = await GetAsync();

        Assert.NotNull(summary.LatestInspectionOn);
        Assert.True(summary.LatestInspectionOn <= DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)));
    }

    /// <summary>
    /// Public, like every other read endpoint. ADR-0005 makes anonymity a decision rather than an
    /// omission, and there is a test per endpoint because a global authorization fallback policy is
    /// the natural thing to add once auth exists and would silently close the whole read surface.
    /// </summary>
    [Fact]
    public async Task Answers_without_a_token()
    {
        HttpResponseMessage response = await fixture.CreateClient()
            .GetAsync("/api/v1/establishments/summary");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// A literal segment beside <c>/{id:int}</c>. Routing scores literals above constrained
    /// parameters so this cannot be shadowed — the same was true of <c>/map</c> and
    /// <c>/filter-options</c>, and it is worth one assertion rather than one assumption each time.
    /// </summary>
    [Fact]
    public async Task Is_not_shadowed_by_the_detail_route()
    {
        HttpResponseMessage response = await fixture.CreateClient()
            .GetAsync("/api/v1/establishments/summary");

        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("establishmentCount", await response.Content.ReadAsStringAsync());
    }
}
