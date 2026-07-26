using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Freshline.Core.Queries;
using Freshline.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Freshline.Api.Tests;

[Collection(ApiCollection.Name)]
public class EstablishmentDetailEndpointTests(ApiFixture fixture)
{
    /// <summary>
    /// A client's view of the contract. The string-enum converter is here because the API writes
    /// enums as names — a caller that assumes the default numeric form cannot read the response,
    /// which is exactly what these tests found the first time they ran.
    /// </summary>
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    [Fact]
    public async Task Returns_the_establishment_with_its_inspections_newest_first()
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage response =
            await client.GetAsync($"/api/v1/establishments/{fixture.Seeded.InspectedTwiceId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        EstablishmentDetail establishment =
            (await response.Content.ReadFromJsonAsync<EstablishmentDetail>(JsonOptions))!;

        Assert.Equal("FIXTURE DINER", establishment.Name);
        Assert.Equal("Manhattan", establishment.Locality);
        Assert.False(establishment.IsAwaitingFirstInspection);

        Assert.Equal(2, establishment.Inspections.Count);
        Assert.Equal(new DateOnly(2026, 6, 1), establishment.Inspections[0].InspectedOn);
        Assert.Equal(new DateOnly(2025, 11, 14), establishment.Inspections[1].InspectedOn);
    }

    /// <summary>
    /// Both the raw and the normalised values are on the wire, and the normalisation is never
    /// inferred from the score. A null grade is the ordinary case, not a gap.
    /// </summary>
    [Fact]
    public async Task Carries_the_raw_and_normalised_grade_and_leaves_an_ungraded_inspection_null()
    {
        HttpClient client = fixture.CreateClient();

        EstablishmentDetail establishment = (await client.GetFromJsonAsync<EstablishmentDetail>(
            $"/api/v1/establishments/{fixture.Seeded.InspectedTwiceId}", JsonOptions))!;

        InspectionDetail graded = establishment.Inspections[0];
        Assert.Equal("A", graded.RawGrade);
        Assert.Equal(12, graded.RawScore);
        Assert.Equal(Core.Model.InspectionOutcome.Good, graded.Outcome);
        Assert.Equal(12, graded.NormalisedSeverity);

        InspectionDetail ungraded = establishment.Inspections[1];
        Assert.Null(ungraded.RawGrade);
        Assert.Null(ungraded.RawScore);
        Assert.Equal(Core.Model.InspectionOutcome.Ungraded, ungraded.Outcome);
        Assert.Null(ungraded.NormalisedSeverity);
        Assert.Empty(ungraded.Violations);
    }

    /// <summary>
    /// "Not Applicable" is a third state and must survive the round trip as null rather than
    /// arriving as false, which would claim the source said a violation was not critical.
    /// </summary>
    [Fact]
    public async Task Carries_violations_ordered_by_code_and_preserves_an_unknown_critical_flag()
    {
        HttpClient client = fixture.CreateClient();

        EstablishmentDetail establishment = (await client.GetFromJsonAsync<EstablishmentDetail>(
            $"/api/v1/establishments/{fixture.Seeded.InspectedTwiceId}", JsonOptions))!;

        IReadOnlyList<ViolationDetail> violations = establishment.Inspections[0].Violations;

        Assert.Equal(["04L", "10F"], violations.Select(violation => violation.Code));
        Assert.True(violations[0].IsCritical);
        Assert.Null(violations[1].IsCritical);
    }

    /// <summary>
    /// The never-inspected sentinel. An establishment holding a permit with no inspection history
    /// is a signal the product is built on, so the endpoint must return it rather than treating an
    /// empty history as an absent establishment.
    /// </summary>
    [Fact]
    public async Task Returns_a_never_inspected_establishment_with_an_empty_history()
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage response =
            await client.GetAsync($"/api/v1/establishments/{fixture.Seeded.NeverInspectedId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        EstablishmentDetail establishment =
            (await response.Content.ReadFromJsonAsync<EstablishmentDetail>(JsonOptions))!;

        Assert.True(establishment.IsAwaitingFirstInspection);
        Assert.Empty(establishment.Inspections);
        Assert.Null(establishment.Cuisine);
    }

    [Fact]
    public async Task Returns_an_establishment_that_has_no_coordinates()
    {
        HttpClient client = fixture.CreateClient();

        EstablishmentDetail establishment = (await client.GetFromJsonAsync<EstablishmentDetail>(
            $"/api/v1/establishments/{fixture.Seeded.WithoutCoordinatesId}", JsonOptions))!;

        Assert.Null(establishment.Latitude);
        Assert.Null(establishment.Longitude);
    }

    /// <summary>
    /// Enums go over the wire as names. The default is the numeric value, which tells a caller
    /// nothing and changes meaning the day somebody reorders the enum.
    /// </summary>
    [Fact]
    public async Task Serialises_the_outcome_as_a_name_rather_than_a_number()
    {
        HttpClient client = fixture.CreateClient();

        string json = await client.GetStringAsync(
            $"/api/v1/establishments/{fixture.Seeded.InspectedTwiceId}");

        Assert.Contains("\"outcome\":\"Good\"", json);
        Assert.DoesNotContain("\"outcome\":1", json);
    }

    /// <summary>
    /// Null is written rather than omitted, so a caller never has to tell "absent" from "null" —
    /// and null is a frequent, meaningful answer in this data.
    /// </summary>
    [Fact]
    public async Task Writes_nulls_rather_than_omitting_the_field()
    {
        HttpClient client = fixture.CreateClient();

        string json = await client.GetStringAsync(
            $"/api/v1/establishments/{fixture.Seeded.WithoutCoordinatesId}");

        Assert.Contains("\"latitude\":null", json);
        Assert.Contains("\"longitude\":null", json);
    }

    [Fact]
    public async Task Returns_404_as_problem_details_when_there_is_no_such_establishment()
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage response = await client.GetAsync("/api/v1/establishments/999999");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        JsonElement problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Establishment not found", problem.GetProperty("title").GetString());
        Assert.Equal(404, problem.GetProperty("status").GetInt32());
    }

    /// <summary>
    /// A non-numeric id fails to match the route rather than reaching the handler, so it is a 404
    /// rather than a 400 — /establishments/banana names no resource. It still has to come back in
    /// the same error shape as everything else, which is what UseStatusCodePages is for.
    /// </summary>
    [Fact]
    public async Task Returns_problem_details_for_an_id_that_is_not_a_number()
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage response = await client.GetAsync("/api/v1/establishments/banana");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Rejects_a_write_to_a_read_only_resource_with_405()
    {
        HttpClient client = fixture.CreateClient();

        HttpResponseMessage response = await client.PostAsync(
            $"/api/v1/establishments/{fixture.Seeded.InspectedTwiceId}", content: null);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }

    /// <summary>
    /// The read path projects to read models, which are not entities, so nothing lands in the
    /// change tracker. That is why <c>AsNoTracking</c> is absent from the query rather than
    /// forgotten — this asserts the claim the comment there makes.
    ///
    /// <para>Both services are resolved from one scope of the running host's container, so the
    /// query runs against exactly the <c>DbContext</c> being inspected — the same wiring a request
    /// gets, rather than a hand-built instance that might behave differently.</para>
    /// </summary>
    [Fact]
    public async Task Reading_an_establishment_tracks_no_entities()
    {
        using IServiceScope scope = fixture.Services.CreateScope();

        IEstablishmentQueries queries = scope.ServiceProvider.GetRequiredService<IEstablishmentQueries>();
        FreshlineDbContext dbContext = scope.ServiceProvider.GetRequiredService<FreshlineDbContext>();

        EstablishmentDetail? establishment =
            await queries.GetAsync(fixture.Seeded.InspectedTwiceId, CancellationToken.None);

        Assert.NotNull(establishment);
        Assert.Empty(dbContext.ChangeTracker.Entries());
    }
}
