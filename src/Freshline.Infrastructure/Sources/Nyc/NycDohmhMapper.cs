using System.Globalization;
using System.Text.Json;
using Freshline.Core.Ingestion;
using Freshline.Core.Model;
using Freshline.Core.Sources;

namespace Freshline.Infrastructure.Sources.Nyc;

/// <summary>The outcome of mapping one source row: either a record, or a reason there isn't one.</summary>
public readonly record struct NycMapResult(CanonicalRecord? Record, string? SkipReason)
{
    public static NycMapResult Mapped(CanonicalRecord record) => new(record, null);

    public static NycMapResult Skipped(string reason) => new(null, reason);
}

/// <summary>
/// Translates one NYC DOHMH row into canonical terms.
///
/// Deliberately a pure static function of a <see cref="JsonElement"/>: no HTTP, no database, no
/// clock beyond the fetch time passed in. That is what lets the normalisation tests run against
/// response bodies captured verbatim from the real API, which is the only way to test the one
/// piece of logic where a wrong answer is silent rather than loud.
/// </summary>
public static class NycDohmhMapper
{
    /// <summary>
    /// NYC encodes "permitted, never inspected" as an inspection dated 1900-01-01 — 3,606 rows
    /// city-wide, carrying a name, phone, address and coordinates but no inspection at all.
    /// Modelled as an establishment awaiting its first inspection, never as an inspection.
    /// </summary>
    public static readonly DateOnly NeverInspectedSentinel = new(1900, 1, 1);

    /// <summary>NYC writes an unknown borough as the string "0" rather than leaving it empty.</summary>
    private const string UnknownBorough = "0";

    public static NycMapResult Map(JsonElement row, string rawPayload, DateTimeOffset fetchedAtUtc)
    {
        string? camis = ReadString(row, "camis");
        if (string.IsNullOrWhiteSpace(camis))
        {
            return NycMapResult.Skipped("row has no camis, so it cannot be identified");
        }

        // One row of 295,294 has no dba. An establishment with no name is useless to every
        // consumer of this data, and inventing one would be worse than dropping it — so it is
        // dropped, counted, and logged rather than silently defaulted.
        string? name = ReadString(row, "dba");
        if (string.IsNullOrWhiteSpace(name))
        {
            return NycMapResult.Skipped($"establishment {camis} has no dba");
        }

        DateOnly? inspectedOn = ReadDate(row, "inspection_date");
        if (inspectedOn is null)
        {
            return NycMapResult.Skipped($"establishment {camis} has an unparseable inspection_date");
        }

        bool awaitingFirstInspection = inspectedOn.Value == NeverInspectedSentinel;

        CanonicalEstablishment establishment = ReadEstablishment(row, camis, name, awaitingFirstInspection);

        if (awaitingFirstInspection)
        {
            return NycMapResult.Mapped(new CanonicalRecord
            {
                SourceId = SourceId.NycDohmh,
                ExternalId = RowKey(camis, inspectedOn.Value, inspectionType: null, violationCode: null),
                RawPayload = rawPayload,
                FetchedAtUtc = fetchedAtUtc,
                Establishment = establishment,
                Inspection = null,
                Violation = null,
            });
        }

        string? inspectionType = ReadString(row, "inspection_type");
        string inspectionExternalId = InspectionKey(camis, inspectedOn.Value, inspectionType);
        string? action = ReadString(row, "action");
        string? rawGrade = ReadString(row, "grade");
        int? rawScore = ReadInt(row, "score");

        CanonicalInspection inspection = new()
        {
            ExternalId = inspectionExternalId,
            InspectedOn = inspectedOn.Value,
            InspectionType = inspectionType,
            Action = action,
            RawGrade = rawGrade,
            RawScore = rawScore,
            Outcome = MapOutcome(rawGrade),
            NormalisedSeverity = MapSeverity(rawScore),
            ClosedByAuthority = IsClosure(action),
        };

        string? violationCode = ReadString(row, "violation_code");
        CanonicalViolation? violation = string.IsNullOrWhiteSpace(violationCode)
            ? null
            : new CanonicalViolation
            {
                ExternalId = $"{inspectionExternalId}:{violationCode}",
                Code = violationCode,
                Description = ReadString(row, "violation_description"),
                IsCritical = MapCriticalFlag(ReadString(row, "critical_flag")),
            };

        return NycMapResult.Mapped(new CanonicalRecord
        {
            SourceId = SourceId.NycDohmh,
            ExternalId = RowKey(camis, inspectedOn.Value, inspectionType, violationCode),
            RawPayload = rawPayload,
            FetchedAtUtc = fetchedAtUtc,
            Establishment = establishment,
            Inspection = inspection,
            Violation = violation,
        });
    }

    /// <summary>
    /// The natural key of a source <em>row</em>. Verified unique across all 295,294 rows once the
    /// 140 groups of exact-duplicate rows NYC publishes are collapsed — and, importantly, verified
    /// against the whole city rather than only the borough M1 ingests, where it has no collisions
    /// at all and would have looked safe. See ADR-0003.
    /// </summary>
    public static string RowKey(string camis, DateOnly inspectedOn, string? inspectionType, string? violationCode)
        => $"{InspectionKey(camis, inspectedOn, inspectionType)}:{violationCode}";

    /// <summary>
    /// NYC publishes no inspection identifier, so one is derived. The risk this carries — that
    /// re-worded inspection-type text mints new ids — is recorded in ADR-0003 rather than hidden.
    /// </summary>
    public static string InspectionKey(string camis, DateOnly inspectedOn, string? inspectionType)
        => $"{camis}:{inspectedOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}:{inspectionType}";

    /// <summary>
    /// Letter grade to the cross-city scale.
    ///
    /// Six values exist, not the three ADR-0002 assumed. There is no default arm: a seventh value
    /// appearing in the source throws rather than being quietly folded into "ungraded", because a
    /// silent reclassification of a grading field is exactly the failure this project cannot
    /// afford. An ingestion run that halts is recoverable; a database that has silently decided
    /// every establishment is fine is not.
    /// </summary>
    public static InspectionOutcome MapOutcome(string? rawGrade) => rawGrade?.Trim().ToUpperInvariant() switch
    {
        null or "" => InspectionOutcome.Ungraded,
        "A" => InspectionOutcome.Good,
        "B" => InspectionOutcome.Fair,
        "C" => InspectionOutcome.Poor,
        // Not yet graded, and grade pending. Both are absences of a result rather than results.
        "N" or "Z" => InspectionOutcome.Ungraded,
        // Pending re-inspection, typically after a closure. An active state, not an absence.
        "P" => InspectionOutcome.PendingReinspection,
        _ => throw new NotSupportedException(
            $"Unrecognised NYC grade '{rawGrade}'. Grading normalisation is the highest-risk logic " +
            "in this system, so an unknown value stops ingestion rather than being guessed at. " +
            "Add an explicit mapping and a fixture test."),
    };

    /// <summary>
    /// Score to severity on the cross-city 0–100 scale where <strong>higher is worse</strong>.
    ///
    /// NYC's score is already higher-is-worse — verified, not assumed: mean score is 10.21 for
    /// grade A, 22.38 for B and 41.71 for C across 129,394 graded rows. So this translation is
    /// close to the identity function, which is precisely the dangerous case: a correct
    /// implementation and an inverted one are the same number of lines and both compile. The
    /// direction is pinned by a fixture test rather than by this comment.
    ///
    /// Scores run past 100 (the observed maximum is 214). Clamping is a deliberate, documented
    /// loss: the raw value is retained on the inspection, and nothing downstream acts differently
    /// on a 120 than on a 214.
    /// </summary>
    public static int? MapSeverity(int? rawScore)
        => rawScore is null ? null : Math.Clamp(rawScore.Value, 0, 100);

    /// <summary>
    /// NYC's critical flag has three values, not two. "Not Applicable" is a genuine third state
    /// and becomes null rather than being flattened into false, which would assert that a
    /// violation was known to be non-critical when nothing of the sort was published.
    /// </summary>
    public static bool? MapCriticalFlag(string? criticalFlag) => criticalFlag?.Trim() switch
    {
        null or "" => null,
        "Critical" => true,
        "Not Critical" => false,
        "Not Applicable" => null,
        _ => throw new NotSupportedException(
            $"Unrecognised NYC critical_flag '{criticalFlag}'. Add an explicit mapping and a fixture test."),
    };

    /// <summary>
    /// Whether the inspection closed the establishment. Matched on the action text, which is the
    /// only place NYC records it. "Establishment re-opened by DOHMH" must not match, which is why
    /// this is a prefix test and not a search for the word "closed".
    /// </summary>
    public static bool IsClosure(string? action)
        => action is not null && action.StartsWith("Establishment Closed by DOHMH", StringComparison.OrdinalIgnoreCase);

    private static CanonicalEstablishment ReadEstablishment(
        JsonElement row, string camis, string name, bool awaitingFirstInspection)
    {
        string? borough = ReadString(row, "boro");

        (double? latitude, double? longitude) = ReadCoordinates(row);

        return new CanonicalEstablishment
        {
            ExternalId = camis,
            Name = name.Trim(),
            Cuisine = ReadString(row, "cuisine_description"),
            Phone = ReadString(row, "phone"),
            AddressLine = BuildAddress(ReadString(row, "building"), ReadString(row, "street")),
            Locality = string.Equals(borough, UnknownBorough, StringComparison.Ordinal) ? null : borough,
            PostalCode = ReadString(row, "zipcode"),
            Latitude = latitude,
            Longitude = longitude,
            IsAwaitingFirstInspection = awaitingFirstInspection,
        };
    }

    /// <summary>
    /// 3,056 rows carry a coordinate of zero, which is a null island in the Gulf of Guinea rather
    /// than a restaurant. Treated as absent, and both components are dropped together so that a
    /// half-populated point can never reach the map.
    /// </summary>
    private static (double? Latitude, double? Longitude) ReadCoordinates(JsonElement row)
    {
        double? latitude = ReadDouble(row, "latitude");
        double? longitude = ReadDouble(row, "longitude");

        if (latitude is null || longitude is null || latitude == 0 || longitude == 0)
        {
            return (null, null);
        }

        return (latitude, longitude);
    }

    private static string? BuildAddress(string? building, string? street)
    {
        string address = $"{building} {street}".Trim();
        return address.Length == 0 ? null : address;
    }

    /// <summary>
    /// Socrata returns every column in this dataset as a JSON string, including the numeric ones.
    /// Numbers are handled anyway so that a column type changing upstream is a non-event.
    /// </summary>
    private static string? ReadString(JsonElement row, string property)
    {
        if (!row.TryGetProperty(property, out JsonElement value))
        {
            return null;
        }

        string? text = value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null,
        };

        return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
    }

    private static int? ReadInt(JsonElement row, string property)
        => int.TryParse(ReadString(row, property), NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsed)
            ? parsed
            : null;

    private static double? ReadDouble(JsonElement row, string property)
        => double.TryParse(ReadString(row, property), NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed)
            ? parsed
            : null;

    private static DateOnly? ReadDate(JsonElement row, string property)
        => DateTime.TryParse(
            ReadString(row, property),
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out DateTime parsed)
            ? DateOnly.FromDateTime(parsed)
            : null;
}
