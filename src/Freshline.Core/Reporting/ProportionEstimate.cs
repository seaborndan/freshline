namespace Freshline.Core.Reporting;

/// <summary>
/// A proportion, together with how much the data actually supports it.
///
/// <para><strong>The problem this type exists to prevent.</strong> Rank cuisines by "percent Poor"
/// and the top of the table is cuisines with three establishments: one bad inspection out of two is
/// 50%, and it will outrank a cuisine with four hundred establishments and a real problem. The table
/// looks precise and means nothing, and a reader has no way to tell — which makes it worse than
/// showing nothing.</para>
///
/// <para>This is where the project's "never invent a number" rule stops being about documentation
/// and becomes a product rule, because <strong>a report does not display data, it asserts a
/// conclusion.</strong> See ADR-0007.</para>
/// </summary>
public sealed record ProportionEstimate
{
    /// <summary>How many members of the group had the property. The numerator.</summary>
    public required int Count { get; init; }

    /// <summary>How many members the group has. The denominator.</summary>
    public required int Total { get; init; }

    /// <summary>
    /// The observed proportion, 0 to 1 — <see cref="Count"/> over <see cref="Total"/>, or zero when
    /// the group is empty.
    ///
    /// <para>This is the honest headline figure and it is what gets displayed. It is deliberately
    /// <em>not</em> what rankings sort by.</para>
    /// </summary>
    public double Observed => Total == 0 ? 0 : (double)Count / Total;

    /// <summary>
    /// The lower bound of the 95% Wilson score interval, and <strong>the value rankings sort
    /// by</strong>.
    ///
    /// <para>Read it as: "the data supports a rate of at least this much". A group of 2 with 1 hit
    /// observes 50% and supports about 9%; a group of 400 with 180 hits observes 45% and supports
    /// about 40%. Sorting on this puts the second above the first, which is the answer a person
    /// asking "which cuisine has the worst results" actually wants — while the displayed percentage
    /// stays the true observed one.</para>
    ///
    /// <para>Small samples sink on their own, with no threshold to choose and defend, and nothing is
    /// hidden from the reader.</para>
    /// </summary>
    public double SupportedAtLeast => WilsonLowerBound(Count, Total);

    /// <summary>
    /// The lower bound of the Wilson score interval at 95% confidence.
    ///
    /// <para><strong>Wilson rather than the textbook normal approximation</strong>
    /// (<c>p̂ ± z·√(p̂(1−p̂)/n)</c>), which fails exactly where this is needed: at small <c>n</c>, and
    /// at proportions near 0 or 1 it produces bounds below zero or above one. Wilson is well behaved
    /// at both, which is the entire reason it is the standard choice for ranking by a rate.</para>
    ///
    /// <para><strong>Computed here rather than in SQL.</strong> It is a scoring rule, and
    /// <c>CLAUDE.md</c> puts scoring rules in Core — where it is a pure function over two integers,
    /// unit-testable without a database. The groups it runs over are small: five boroughs, 89
    /// cuisines.</para>
    /// </summary>
    /// <param name="count">Members with the property. Must not exceed <paramref name="total"/>.</param>
    /// <param name="total">Members of the group.</param>
    public static double WilsonLowerBound(int count, int total)
    {
        if (total <= 0)
        {
            return 0;
        }

        if (count < 0 || count > total)
        {
            throw new ArgumentOutOfRangeException(
                nameof(count),
                count,
                $"A count of {count} out of {total} is not a proportion. This is a bug in the query " +
                "producing it, not bad data — a subset cannot be larger than the set.");
        }

        // 1.96, the two-sided 95% normal quantile. Named rather than inlined because a bare 1.96 in
        // this formula is the kind of constant a reader has to look up to check.
        const double z = 1.959963984540054;

        double observed = (double)count / total;
        double zSquared = z * z;

        double denominator = 1 + (zSquared / total);
        double centre = observed + (zSquared / (2 * total));
        double margin = z * Math.Sqrt((observed * (1 - observed) / total) + (zSquared / (4.0 * total * total)));

        double lower = (centre - margin) / denominator;

        // Clamped only against arithmetic noise. The formula cannot leave [0, 1] mathematically, but
        // a lower bound of -1e-17 rendering as "-0.0%" would be a distracting lie about the data.
        return Math.Clamp(lower, 0, 1);
    }
}
