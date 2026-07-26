using Freshline.Core.Ingestion;
using Freshline.Infrastructure.Sources.Nyc;

namespace Freshline.Infrastructure.Tests;

/// <summary>
/// The windowing rules, tested as pure logic. These are cheap and worth having in detail, because
/// every one of them is a way to silently miss data rather than to fail visibly.
/// </summary>
public class IngestionWindowTests
{
    private static readonly DateOnly Floor = new(2025, 7, 25);

    [Fact]
    public void The_first_run_starts_at_the_backfill_floor()
    {
        IngestionWindow window = IngestionWindow.FromWatermark(watermark: null, Floor, lookbackDays: 30);

        Assert.Equal(Floor, window.From);
    }

    /// <summary>
    /// The lookback exists because NYC restates rows in place and publishes no per-row change
    /// timestamp. Starting exactly at the watermark would never re-read a corrected record.
    /// </summary>
    [Fact]
    public void A_later_run_starts_before_the_watermark_by_the_lookback()
    {
        IngestionWindow window = IngestionWindow.FromWatermark(new DateOnly(2026, 7, 22), Floor, lookbackDays: 30);

        Assert.Equal(new DateOnly(2026, 6, 22), window.From);
    }

    /// <summary>
    /// The floor is a floor. Without this, a watermark close to the start of the deployment's
    /// scope would let the lookback walk backwards into data this deployment never intended to hold.
    /// </summary>
    [Fact]
    public void The_lookback_never_walks_back_past_the_floor()
    {
        IngestionWindow window = IngestionWindow.FromWatermark(new DateOnly(2025, 8, 1), Floor, lookbackDays: 30);

        Assert.Equal(Floor, window.From);
    }

    [Fact]
    public void A_zero_lookback_starts_exactly_at_the_watermark()
    {
        IngestionWindow window = IngestionWindow.FromWatermark(new DateOnly(2026, 7, 22), Floor, lookbackDays: 0);

        Assert.Equal(new DateOnly(2026, 7, 22), window.From);
    }

    [Fact]
    public void A_negative_lookback_is_rejected_rather_than_silently_moving_the_window_forward()
        => Assert.Throws<ArgumentOutOfRangeException>(
            () => IngestionWindow.FromWatermark(new DateOnly(2026, 7, 22), Floor, lookbackDays: -1));

    /// <summary>
    /// The disjunction that keeps never-inspected establishments in scope. They are dated
    /// 1900-01-01, which is below every window, so a plain date filter would drop the
    /// newly-licensed signal entirely — 118 establishments in the borough M1 ingests.
    /// </summary>
    [Fact]
    public void The_where_clause_keeps_never_inspected_establishments_in_scope()
    {
        string clause = NycDohmhConnector.BuildWhereClause(
            new IngestionWindow { From = new DateOnly(2026, 6, 22) }, borough: "Staten Island");

        Assert.Contains("inspection_date >= '2026-06-22T00:00:00'", clause, StringComparison.Ordinal);
        Assert.Contains("OR inspection_date = '1900-01-01T00:00:00'", clause, StringComparison.Ordinal);
        Assert.Contains("boro = 'Staten Island'", clause, StringComparison.Ordinal);
    }

    [Fact]
    public void The_where_clause_omits_the_borough_filter_when_ingesting_the_whole_city()
    {
        string clause = NycDohmhConnector.BuildWhereClause(
            new IngestionWindow { From = new DateOnly(2026, 6, 22) }, borough: null);

        Assert.DoesNotContain("boro", clause, StringComparison.Ordinal);
    }

    [Fact]
    public void A_borough_containing_a_quote_is_escaped_rather_than_breaking_the_query()
    {
        string clause = NycDohmhConnector.BuildWhereClause(
            new IngestionWindow { From = new DateOnly(2026, 6, 22) }, borough: "O'Hare");

        Assert.Contains("boro = 'O''Hare'", clause, StringComparison.Ordinal);
    }
}
