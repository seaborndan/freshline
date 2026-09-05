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
