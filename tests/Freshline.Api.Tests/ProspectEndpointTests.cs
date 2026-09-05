using System.Net;
using System.Net.Http.Json;
using Freshline.Core.Model;
using Freshline.Core.Queries;
using Microsoft.EntityFrameworkCore;

namespace Freshline.Api.Tests;

[Collection(ApiCollection.Name)]
public class ProspectEndpointTests(ApiFixture fixture)
{
    [Fact]
    public async Task Category_changes_the_evidence_and_all_combines_it_without_duplicate_places()
    {
        using HttpClient client = fixture.CreateClient();
        const string range = "from=2026-01-01&to=2026-12-31";
        ProspectResult? sanitation = await client.GetFromJsonAsync<ProspectResult>($"/api/v1/prospects?{range}&category=sanitation");
        Assert.NotNull(sanitation);
        Assert.Equal("10F", Assert.Single(Assert.Single(sanitation.Items).Evidence).Code);
        ProspectResult? all = await client.GetFromJsonAsync<ProspectResult>($"/api/v1/prospects?{range}&category=all");
        Assert.NotNull(all);
        Assert.Equal(new[] { "04L", "10F" }, Assert.Single(all.Items).Evidence.Select(e => e.Code));
        ProspectResult? temperature = await client.GetFromJsonAsync<ProspectResult>($"/api/v1/prospects?{range}&category=temperature");
        Assert.NotNull(temperature);
        Assert.Empty(temperature.Items);
    }

    [Fact]
    public async Task Unknown_categories_are_rejected_instead_of_falling_back_to_pests()
    {
        using HttpClient client = fixture.CreateClient();
        using HttpResponseMessage response = await client.GetAsync("/api/v1/prospects?category=unknown");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Category_catalog_exposes_the_evidence_rules()
    {
        using HttpClient client = fixture.CreateClient();
        var categories = await client.GetFromJsonAsync<OpportunityCategory[]>("/api/v1/prospects/categories");
        Assert.NotNull(categories);
        Assert.Equal(4, categories.Length);
        Assert.Contains(categories, c => c.Id == "facilities" && c.Codes.Contains("10B"));
    }
    [Fact]
    public async Task Returns_only_relevant_evidence_from_latest_inspection()
    {
        using HttpClient client = fixture.CreateClient();
        ProspectResult? result = await client.GetFromJsonAsync<ProspectResult>("/api/v1/prospects?from=2026-01-01&to=2026-12-31");
        Assert.NotNull(result);
        Prospect row = Assert.Single(result.Items);
        Assert.Equal(fixture.Seeded.InspectedTwiceId, row.Id);
        Assert.Equal("04L", Assert.Single(row.Evidence).Code);
        Assert.False(result.IsTruncated);
    }

    [Fact]
    public async Task A_newer_clean_inspection_excludes_older_evidence_even_outside_selected_period()
    {
        await using var db = fixture.CreateDbContext();
        Inspection previous = await db.Inspections.SingleAsync(i => i.Id == fixture.Seeded.NewerInspectionId);
        Inspection clean = new()
        {
            SourceId = previous.SourceId,
            ExternalId = "prospect-test-clean",
            EstablishmentId = previous.EstablishmentId,
            InspectedOn = new DateOnly(2026, 7, 1),
            Outcome = InspectionOutcome.Good,
            SourceRecordId = previous.SourceRecordId,
            FetchedAtUtc = previous.FetchedAtUtc,
        };
        db.Inspections.Add(clean);
        await db.SaveChangesAsync();
        try
        {
            using HttpClient client = fixture.CreateClient();
            ProspectResult? result = await client.GetFromJsonAsync<ProspectResult>("/api/v1/prospects?from=2026-01-01&to=2026-06-30");
            Assert.NotNull(result);
            Assert.Empty(result.Items);
        }
        finally
        {
            db.Inspections.Remove(clean);
            await db.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task Rejects_reversed_dates()
    {
        using HttpClient client = fixture.CreateClient();
        using HttpResponseMessage response = await client.GetAsync("/api/v1/prospects?from=2026-07-01&to=2026-06-01");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
