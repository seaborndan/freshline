using System.Net;
using System.Net.Http.Json;
using Freshline.Core.Queries;
using Microsoft.EntityFrameworkCore;
namespace Freshline.Api.Tests;

[Collection(ApiCollection.Name)]
public class ResearchEndpointTests(ApiFixture fixture)
{
    [Fact]
    public async Task Pre_permit_signal_does_not_resurface_after_a_newer_inspection()
    {
        await using var db = fixture.CreateDbContext();
        var previous = await db.Inspections.SingleAsync(i => i.Id == fixture.Seeded.NewerInspectionId);
        var originalType = previous.InspectionType;
        previous.InspectionType = "Pre-permit (Operational) / Initial Inspection";
        await db.SaveChangesAsync();
        var newer = new Freshline.Core.Model.Inspection { SourceId = previous.SourceId, ExternalId = "research-newer-test", EstablishmentId = previous.EstablishmentId, InspectedOn = new DateOnly(2026, 7, 1), Outcome = Freshline.Core.Model.InspectionOutcome.Good, SourceRecordId = previous.SourceRecordId, FetchedAtUtc = previous.FetchedAtUtc };
        try
        {
            using var client = fixture.CreateClient();
            var before = await client.GetFromJsonAsync<ResearchResult>("/api/v1/research?from=2026-01-01&to=2026-06-30&prePermit=true");
            Assert.NotNull(before);
            Assert.Contains(before.Items, p => p.Id == previous.EstablishmentId);
            db.Inspections.Add(newer);
            await db.SaveChangesAsync();
            var after = await client.GetFromJsonAsync<ResearchResult>("/api/v1/research?from=2026-01-01&to=2026-06-30&prePermit=true");
            Assert.NotNull(after);
            Assert.DoesNotContain(after.Items, p => p.Id == previous.EstablishmentId);
        }
        finally
        {
            previous.InspectionType = originalType;
            if (newer.Id != 0) db.Inspections.Remove(newer);
            await db.SaveChangesAsync();
        }
    }
    [Fact]
    public async Task All_code_matching_requires_every_code_on_the_latest_inspection()
    {
        using var client = fixture.CreateClient();
        var all = await client.GetFromJsonAsync<ResearchResult>("/api/v1/research?from=2026-01-01&to=2026-12-31&codes=04L,10F&requireAll=true");
        Assert.NotNull(all);
        Assert.Equal(fixture.Seeded.InspectedTwiceId, Assert.Single(all.Items).Id);
        var absent = await client.GetFromJsonAsync<ResearchResult>("/api/v1/research?from=2026-01-01&to=2026-12-31&codes=04L,02G&requireAll=true");
        Assert.NotNull(absent);
        Assert.Empty(absent.Items);
    }
    [Theory]
    [InlineData("from=2026-12-31&to=2026-01-01")]
    [InlineData("codes=bad%27code")]
    [InlineData("codes=A,B,C,D,E,F,G,H,I,J,K")]
    public async Task Invalid_research_rules_are_rejected(string query)
    {
        using var client = fixture.CreateClient();
        using var response = await client.GetAsync($"/api/v1/research?{query}");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
    [Fact]
    public async Task Data_health_reports_actual_database_counts()
    {
        using var client = fixture.CreateClient();
        var health = await client.GetFromJsonAsync<DataHealth>("/api/v1/data-health");
        Assert.NotNull(health);
        await using var db = fixture.CreateDbContext();
        Assert.Equal(await db.Establishments.CountAsync(), health.Establishments);
        Assert.Equal(await db.Inspections.CountAsync(), health.Inspections);
        Assert.Equal(await db.Establishments.CountAsync(e => e.Latitude == null || e.Longitude == null), health.MissingCoordinates);
    }
}
