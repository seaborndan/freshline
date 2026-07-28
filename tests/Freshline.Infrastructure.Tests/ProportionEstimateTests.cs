using Freshline.Core.Reporting;

namespace Freshline.Infrastructure.Tests;

/// <summary>
/// The statistics behind every ranking a report produces.
///
/// <para>Tested directly and hard, because this is the code that decides whether a table of
/// percentages is informative or authoritative-looking nonsense. A wrong answer here does not throw
/// or fail a request — it produces a plausible ranking with the wrong thing at the top, which is the
/// same failure mode as a sign error in grading normalisation.</para>
/// </summary>
public class ProportionEstimateTests
{
    /// <summary>
    /// Checked against the published Wilson interval for 5 of 10 at 95%, which is
    /// (0.2366, 0.7634). Only the lower bound is used here.
    ///
    /// <para>An externally known value rather than one this implementation produced: a test written
    /// by running the code and pasting the output proves the code does what it does.</para>
    /// </summary>
    [Fact]
    public void Matches_the_published_interval_for_a_known_case()
    {
        double lower = ProportionEstimate.WilsonLowerBound(count: 5, total: 10);

        Assert.Equal(0.2366, lower, precision: 4);
    }

    /// <summary>
    /// The entire point, stated as a test.
    ///
    /// <para>A cuisine with 2 establishments and 1 bad result observes 50%. A cuisine with 400 and
    /// 180 observes 45% — lower. Ranked by the observed rate the tiny group wins; ranked by what the
    /// data supports it does not, which is the answer somebody asking "which cuisine has the worst
    /// results" actually wants.</para>
    /// </summary>
    [Fact]
    public void Ranks_a_large_sample_above_a_tiny_one_with_a_higher_observed_rate()
    {
        ProportionEstimate tiny = new() { Count = 1, Total = 2 };
        ProportionEstimate large = new() { Count = 180, Total = 400 };

        Assert.True(tiny.Observed > large.Observed, "the tiny group must look worse by raw rate");
        Assert.True(
            large.SupportedAtLeast > tiny.SupportedAtLeast,
            $"the large group must rank above the tiny one: {large.SupportedAtLeast} " +
            $"vs {tiny.SupportedAtLeast}");
    }

    /// <summary>
    /// The displayed figure stays the true observed proportion. The interval changes the
    /// <em>order</em> of a table, never the number printed in it — a report that showed an adjusted
    /// percentage would be reporting something that did not happen.
    /// </summary>
    [Fact]
    public void Reports_the_observed_proportion_unadjusted()
    {
        ProportionEstimate estimate = new() { Count = 1, Total = 2 };

        Assert.Equal(0.5, estimate.Observed);
    }

    /// <summary>
    /// More evidence at the same rate means a higher supported floor. This is the property that makes
    /// the ordering meaningful rather than merely different.
    /// </summary>
    [Theory]
    [InlineData(1, 2)]
    [InlineData(10, 20)]
    [InlineData(100, 200)]
    [InlineData(1000, 2000)]
    public void Rises_towards_the_observed_rate_as_evidence_grows(int count, int total)
    {
        double lower = ProportionEstimate.WilsonLowerBound(count, total);

        Assert.True(lower < 0.5, "the lower bound must stay below the observed rate");
        Assert.True(lower > 0, "a positive count must support a positive rate");

        if (total > 2)
        {
            Assert.True(
                lower > ProportionEstimate.WilsonLowerBound(count / 10, total / 10),
                "ten times the evidence at the same rate must support a higher floor");
        }
    }

    /// <summary>
    /// Where the textbook normal approximation breaks and Wilson does not: at zero and at one it
    /// produces a zero-width interval, and near them it produces bounds outside [0, 1].
    /// </summary>
    [Theory]
    [InlineData(0, 10)]
    [InlineData(0, 1)]
    [InlineData(10, 10)]
    [InlineData(1, 1)]
    public void Stays_inside_zero_and_one_at_the_extremes(int count, int total)
    {
        double lower = ProportionEstimate.WilsonLowerBound(count, total);

        Assert.InRange(lower, 0, 1);
    }

    /// <summary>
    /// Nothing observed supports nothing, however many were looked at.
    ///
    /// <para>Asserted to a tolerance rather than exactly, and the reason is worth keeping. At a count
    /// of zero the formula's centre and margin are algebraically identical — both reduce to
    /// <c>z²/2n</c> — so the difference is exactly zero on paper and 4.3e-19 in double arithmetic,
    /// because <c>√(z²/4n²)</c> and <c>z/2n</c> are not the same sequence of operations. The value is
    /// correct to nineteen significant figures and rounds to 0.0% in anything that displays it.</para>
    ///
    /// <para>Not clamped away in the implementation: rounding a correct answer to make a test pass
    /// would be treating the arithmetic as the problem.</para>
    /// </summary>
    [Fact]
    public void Supports_nothing_when_nothing_was_observed()
    {
        Assert.Equal(0, ProportionEstimate.WilsonLowerBound(count: 0, total: 500), precision: 12);
    }

    /// <summary>
    /// A single hit out of a single observation is the weakest possible evidence of a universal rate.
    /// It observes 100% and must not rank as such.
    /// </summary>
    [Fact]
    public void Does_not_treat_one_of_one_as_certainty()
    {
        ProportionEstimate estimate = new() { Count = 1, Total = 1 };

        Assert.Equal(1.0, estimate.Observed);
        Assert.True(
            estimate.SupportedAtLeast < 0.3,
            $"one of one must not support a high rate, got {estimate.SupportedAtLeast}");
    }

    /// <summary>
    /// An empty group is a real case — a cuisine filtered down to nothing — and is not a failure.
    /// </summary>
    [Fact]
    public void Treats_an_empty_group_as_zero_rather_than_dividing_by_it()
    {
        ProportionEstimate estimate = new() { Count = 0, Total = 0 };

        Assert.Equal(0, estimate.Observed);
        Assert.Equal(0, estimate.SupportedAtLeast);
    }

    /// <summary>
    /// A count larger than its total is not bad data to be tolerated, it is a broken query — the
    /// subset cannot exceed the set. Failing loudly here is what stops a nonsensical proportion
    /// reaching a table that looks authoritative.
    /// </summary>
    [Fact]
    public void Refuses_a_count_larger_than_its_total()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => ProportionEstimate.WilsonLowerBound(count: 11, total: 10));
    }
}
