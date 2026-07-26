using Freshline.Core.Ingestion;
using Freshline.Core.Model;
using Freshline.Infrastructure.Sources.Nyc;

namespace Freshline.Infrastructure.Tests;

public class NycDohmhMapperTests
{
    /// <summary>
    /// The test this project exists to have.
    ///
    /// NYC's score runs in the same direction as the canonical severity scale, so the correct
    /// translation is nearly the identity function — and an inverted one would compile, run, and
    /// produce a database in which the worst restaurants look like the best. Nothing about the
    /// output would appear broken.
    ///
    /// So the direction is asserted against real captured responses rather than trusted to a
    /// comment: in the fixtures a grade-A inspection scores 6 and 12, a grade-C inspection scores
    /// 39, and this fails if that ordering is ever reversed.
    /// </summary>
    [Fact]
    public void A_graded_establishment_is_less_severe_than_a_C_graded_one()
    {
        int[] gradeASeverities =
        [
            .. NycFixtures.Load("graded-a-with-violations.json")
                .Select(r => r.Inspection!.NormalisedSeverity!.Value)
        ];

        int[] gradeCSeverities =
        [
            .. NycFixtures.Load("graded-c.json")
                .Select(r => r.Inspection!.NormalisedSeverity!.Value)
        ];

        Assert.NotEmpty(gradeASeverities);
        Assert.NotEmpty(gradeCSeverities);

        Assert.True(
            gradeASeverities.Max() < gradeCSeverities.Min(),
            $"Grading direction is inverted: worst grade-A severity was {gradeASeverities.Max()}, " +
            $"best grade-C severity was {gradeCSeverities.Min()}. Higher severity must mean worse.");
    }

    [Theory]
    [InlineData("A", InspectionOutcome.Good)]
    [InlineData("B", InspectionOutcome.Fair)]
    [InlineData("C", InspectionOutcome.Poor)]
    [InlineData("N", InspectionOutcome.Ungraded)]
    [InlineData("Z", InspectionOutcome.Ungraded)]
    [InlineData("P", InspectionOutcome.PendingReinspection)]
    [InlineData(null, InspectionOutcome.Ungraded)]
    [InlineData("", InspectionOutcome.Ungraded)]
    public void Every_published_grade_maps_explicitly(string? rawGrade, InspectionOutcome expected)
        => Assert.Equal(expected, NycDohmhMapper.MapOutcome(rawGrade));

    /// <summary>
    /// ADR-0002 assumed three grades; there are six. A seventh must stop ingestion rather than be
    /// folded silently into "ungraded", because a grading field that quietly reclassifies itself
    /// is the one failure this system cannot detect from its own output.
    /// </summary>
    [Fact]
    public void An_unrecognised_grade_throws_rather_than_defaulting()
        => Assert.Throws<NotSupportedException>(() => NycDohmhMapper.MapOutcome("Q"));

    [Theory]
    [InlineData("Critical", true)]
    [InlineData("Not Critical", false)]
    [InlineData("Not Applicable", null)]
    [InlineData(null, null)]
    public void Critical_flag_keeps_not_applicable_distinct_from_not_critical(string? flag, bool? expected)
        => Assert.Equal(expected, NycDohmhMapper.MapCriticalFlag(flag));

    [Fact]
    public void Scores_above_the_scale_are_clamped_but_the_raw_value_is_kept()
    {
        Assert.Equal(100, NycDohmhMapper.MapSeverity(214));
        Assert.Equal(39, NycDohmhMapper.MapSeverity(39));
        Assert.Null(NycDohmhMapper.MapSeverity(null));
    }

    /// <summary>
    /// The newly-licensed signal. NYC publishes these as an inspection dated 1900-01-01; modelling
    /// that literally would put a phantom inspection on the establishment's history and would show
    /// up on the map as a 126-year-old visit.
    /// </summary>
    [Fact]
    public void Never_inspected_establishments_become_establishments_not_inspections()
    {
        IReadOnlyList<CanonicalRecord> records = NycFixtures.Load("never-inspected-sentinel.json");

        Assert.NotEmpty(records);

        foreach (CanonicalRecord record in records)
        {
            Assert.Null(record.Inspection);
            Assert.Null(record.Violation);
            Assert.True(record.Establishment.IsAwaitingFirstInspection);
            Assert.False(string.IsNullOrWhiteSpace(record.Establishment.Name));
        }
    }

    [Fact]
    public void An_inspection_with_no_violations_still_produces_an_inspection()
    {
        IReadOnlyList<CanonicalRecord> records = NycFixtures.Load("no-violations-recorded.json");

        Assert.NotEmpty(records);

        foreach (CanonicalRecord record in records)
        {
            Assert.NotNull(record.Inspection);
            Assert.Null(record.Violation);
            Assert.False(record.Establishment.IsAwaitingFirstInspection);
        }
    }

    [Fact]
    public void A_closure_is_recognised_from_the_action_text()
    {
        IReadOnlyList<CanonicalRecord> records = NycFixtures.Load("closed-by-dohmh.json");

        Assert.NotEmpty(records);
        Assert.All(records, record => Assert.True(record.Inspection!.ClosedByAuthority));
    }

    /// <summary>
    /// "Establishment re-opened by DOHMH" contains neither the prefix nor, importantly, any hint
    /// that a substring search for "closed" would be safe. This pins the distinction.
    /// </summary>
    [Fact]
    public void A_reopening_is_not_a_closure()
    {
        Assert.True(NycDohmhMapper.IsClosure(
            "Establishment Closed by DOHMH. Violations were cited in the following area(s) and those requiring immediate action were addressed."));
        Assert.False(NycDohmhMapper.IsClosure("Establishment re-opened by DOHMH."));
        Assert.False(NycDohmhMapper.IsClosure("Violations were cited in the following area(s)."));
        Assert.False(NycDohmhMapper.IsClosure(null));
    }

    /// <summary>
    /// Every violation row of one inspection repeats that inspection's fields. Six rows must
    /// collapse to one establishment and one inspection carrying six violations — the record-grain
    /// difference ADR-0002 was written about, in miniature.
    /// </summary>
    [Fact]
    public void Violation_rows_of_one_inspection_share_one_inspection_key()
    {
        IReadOnlyList<CanonicalRecord> records = NycFixtures.Load("graded-c.json");

        Assert.Equal(6, records.Count);
        Assert.Single(records.Select(r => r.Establishment.ExternalId).Distinct());
        Assert.Single(records.Select(r => r.Inspection!.ExternalId).Distinct());
        Assert.Equal(6, records.Select(r => r.Violation!.ExternalId).Distinct().Count());
    }

    /// <summary>
    /// The two rows in this fixture are byte-identical in the source. They must produce one row
    /// key, so that the deduplication in the runner has something to collapse them on.
    /// </summary>
    [Fact]
    public void Exact_duplicate_source_rows_produce_one_row_key()
    {
        IReadOnlyList<CanonicalRecord> records = NycFixtures.Load("duplicate-rows.json");

        Assert.Equal(2, records.Count);
        Assert.Single(records.Select(r => r.ExternalId).Distinct());
    }

    [Fact]
    public void Coordinates_of_zero_are_treated_as_absent()
    {
        using var document = System.Text.Json.JsonDocument.Parse(
            """[{"camis":"1","dba":"NOWHERE","inspection_date":"2026-01-01T00:00:00.000","latitude":"0.0000000","longitude":"0.0000000"}]""");

        NycMapResult result = NycDohmhMapper.Map(
            document.RootElement[0], document.RootElement[0].GetRawText(), DateTimeOffset.UnixEpoch);

        Assert.NotNull(result.Record);
        Assert.Null(result.Record.Establishment.Latitude);
        Assert.Null(result.Record.Establishment.Longitude);
    }

    [Fact]
    public void An_unknown_borough_sentinel_becomes_null_rather_than_the_string_zero()
    {
        using var document = System.Text.Json.JsonDocument.Parse(
            """[{"camis":"1","dba":"SOMEWHERE","boro":"0","inspection_date":"2026-01-01T00:00:00.000"}]""");

        NycMapResult result = NycDohmhMapper.Map(
            document.RootElement[0], document.RootElement[0].GetRawText(), DateTimeOffset.UnixEpoch);

        Assert.NotNull(result.Record);
        Assert.Null(result.Record.Establishment.Locality);
    }

    [Fact]
    public void A_row_with_no_establishment_name_is_skipped_with_a_reason()
    {
        using var document = System.Text.Json.JsonDocument.Parse(
            """[{"camis":"1","inspection_date":"2026-01-01T00:00:00.000"}]""");

        NycMapResult result = NycDohmhMapper.Map(
            document.RootElement[0], document.RootElement[0].GetRawText(), DateTimeOffset.UnixEpoch);

        Assert.Null(result.Record);
        Assert.NotNull(result.SkipReason);
    }
}
