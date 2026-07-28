using Freshline.Core.Queries;
using Microsoft.Extensions.DependencyInjection;

namespace Freshline.Api.Tests;

/// <summary>
/// The aggregate that every ranking report is built on.
///
/// <para>Exercised through the real query against a real SQL Server rather than through a stub,
/// because the parts most likely to be wrong are the parts EF translates: the correlated "latest
/// inspection" subquery, and what a date range does to it.</para>
/// </summary>
[Collection(ApiCollection.Name)]
public class OutcomeBreakdownQueryTests(ApiFixture fixture)
{
    private async Task<OutcomeBreakdown> RunAsync(OutcomeBreakdownQuery query)
    {
        using IServiceScope scope = fixture.Services.CreateScope();
        IReportQueries queries = scope.ServiceProvider.GetRequiredService<IReportQueries>();

        return await queries.GetOutcomeBreakdownAsync(query, CancellationToken.None);
    }

    /// <summary>
    /// The fixture puts two establishments in Manhattan: one inspected twice, most recently Good on
    /// 2026-06-01, and one awaiting its first inspection.
    /// </summary>
    [Fact]
    public async Task Counts_each_establishment_once_under_its_latest_outcome()
    {
        OutcomeBreakdown breakdown = await RunAsync(
            new OutcomeBreakdownQuery { Dimension = ReportDimension.Locality });

        OutcomeBreakdownRow manhattan = Assert.Single(
            breakdown.Rows, row => row.Group == "Manhattan");

        Assert.Equal(2, manhattan.Total);
        Assert.Equal(1, manhattan.NeverInspected);

        // Good, not Ungraded: the establishment's older inspection on 2025-11-14 was Ungraded, and
        // only the latest counts. An establishment contributes one outcome, not one per inspection.
        Assert.Equal(1, manhattan.Good);
        Assert.Equal(0, manhattan.Ungraded);
    }

    /// <summary>
    /// The arithmetic a reader will do in their head, asserted so it cannot silently stop holding.
    ///
    /// <para>Every establishment in a group is in exactly one bucket: it has a counted outcome, or it
    /// has never been inspected, or it has been inspected but not within the period. A table whose
    /// columns do not sum to its total is one a reader is right to distrust.</para>
    /// </summary>
    [Fact]
    public async Task Puts_every_establishment_in_exactly_one_bucket()
    {
        foreach (ReportDimension dimension in new[] { ReportDimension.Locality, ReportDimension.Cuisine })
        {
            OutcomeBreakdown breakdown = await RunAsync(new OutcomeBreakdownQuery { Dimension = dimension });

            foreach (OutcomeBreakdownRow row in breakdown.Rows)
            {
                Assert.Equal(
                    row.Total,
                    row.Inspected + row.NeverInspected + row.NoInspectionInPeriod);
            }
        }
    }

    /// <summary>
    /// Rates are over inspected establishments, not over every establishment.
    ///
    /// <para>Including the never-inspected in the denominator would dilute every rate by how
    /// thoroughly the city has visited that group — so a borough with a large backlog would look
    /// *better* than one that has been inspected. That is a statement about enforcement wearing the
    /// costume of a statement about hygiene.</para>
    /// </summary>
    [Fact]
    public async Task Excludes_establishments_without_an_outcome_from_the_denominator()
    {
        OutcomeBreakdown breakdown = await RunAsync(
            new OutcomeBreakdownQuery { Dimension = ReportDimension.Locality });

        OutcomeBreakdownRow manhattan = Assert.Single(
            breakdown.Rows, row => row.Group == "Manhattan");

        // Two establishments, one of them never inspected: the denominator is one, not two.
        Assert.Equal(2, manhattan.Total);
        Assert.Equal(1, manhattan.Inspected);
        Assert.Equal(1, manhattan.PoorShare.Total);
    }

    /// <summary>
    /// The semantic decision on <see cref="OutcomeBreakdownQuery.InspectedFrom"/>, tested.
    ///
    /// <para>The fixture's twice-inspected establishment was Ungraded on 2025-11-14 and Good on
    /// 2026-06-01. A report about 2025 must say Ungraded — the latest inspection *within the period*.
    /// The other reading, "establishments whose all-time latest inspection falls in the period",
    /// would exclude it entirely and answer a question nobody asked.</para>
    /// </summary>
    [Fact]
    public async Task Reports_the_latest_inspection_within_the_period_not_the_latest_overall()
    {
        OutcomeBreakdown breakdown = await RunAsync(new OutcomeBreakdownQuery
        {
            Dimension = ReportDimension.Locality,
            InspectedFrom = new DateOnly(2025, 1, 1),
            InspectedTo = new DateOnly(2025, 12, 31),
        });

        OutcomeBreakdownRow manhattan = Assert.Single(
            breakdown.Rows, row => row.Group == "Manhattan");

        Assert.Equal(1, manhattan.Ungraded);
        Assert.Equal(0, manhattan.Good);
    }

    /// <summary>
    /// An establishment inspected outside the period is neither counted nor treated as never
    /// inspected — those are different facts and a single "no data" column would merge them.
    /// </summary>
    [Fact]
    public async Task Separates_not_inspected_in_this_period_from_never_inspected()
    {
        OutcomeBreakdown breakdown = await RunAsync(new OutcomeBreakdownQuery
        {
            Dimension = ReportDimension.Locality,
            InspectedFrom = new DateOnly(2020, 1, 1),
            InspectedTo = new DateOnly(2020, 12, 31),
        });

        OutcomeBreakdownRow manhattan = Assert.Single(
            breakdown.Rows, row => row.Group == "Manhattan");

        Assert.Equal(0, manhattan.Inspected);
        Assert.Equal(1, manhattan.NeverInspected);
        Assert.Equal(1, manhattan.NoInspectionInPeriod);
        Assert.True(breakdown.HasDateRange);
    }

    /// <summary>
    /// Establishments whose grouping column is null cannot appear in any row, and the count of them
    /// is reported rather than dropped.
    ///
    /// <para>Not a corner case: 3,605 establishments have no cuisine — exactly those never inspected
    /// — and 66 have no locality. A table whose totals do not reconcile against the dataset summary,
    /// with nothing explaining the gap, invites a reader to conclude the report is broken.</para>
    /// </summary>
    [Fact]
    public async Task Reports_how_many_establishments_could_not_be_grouped()
    {
        OutcomeBreakdown byLocality = await RunAsync(
            new OutcomeBreakdownQuery { Dimension = ReportDimension.Locality });

        // Four of the six seeded establishments have no locality.
        Assert.Equal(4, byLocality.UngroupedEstablishments);

        OutcomeBreakdown byCuisine = await RunAsync(
            new OutcomeBreakdownQuery { Dimension = ReportDimension.Cuisine });

        // One has no cuisine — the never-inspected sentinel, matching the live correspondence.
        Assert.Equal(1, byCuisine.UngroupedEstablishments);
    }

    /// <summary>
    /// A filter on one dimension while grouping by another is what makes "results by cuisine, in
    /// Manhattan only" answerable from a single report.
    /// </summary>
    [Fact]
    public async Task Filters_on_one_dimension_while_grouping_by_the_other()
    {
        OutcomeBreakdown breakdown = await RunAsync(new OutcomeBreakdownQuery
        {
            Dimension = ReportDimension.Cuisine,
            Locality = "Manhattan",
        });

        // Only the twice-inspected American establishment is in Manhattan and has a cuisine.
        OutcomeBreakdownRow row = Assert.Single(breakdown.Rows);
        Assert.Equal("American", row.Group);
        Assert.Equal(1, row.Good);
    }

    /// <summary>
    /// ADR-0007's ordering, asserted end to end rather than only on the statistics in isolation:
    /// rows come back worst-first by what the evidence supports.
    /// </summary>
    [Fact]
    public async Task Orders_rows_by_what_the_evidence_supports()
    {
        OutcomeBreakdown breakdown = await RunAsync(
            new OutcomeBreakdownQuery { Dimension = ReportDimension.Cuisine });

        double[] supported = breakdown.Rows.Select(row => row.PoorShare.SupportedAtLeast).ToArray();

        Assert.Equal(supported.OrderByDescending(value => value), supported);
    }
}
