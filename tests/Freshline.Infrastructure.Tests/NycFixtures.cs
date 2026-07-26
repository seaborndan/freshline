using System.Text.Json;
using Freshline.Core.Ingestion;
using Freshline.Infrastructure.Sources.Nyc;

namespace Freshline.Infrastructure.Tests;

/// <summary>
/// Loads the captured NYC responses and runs them through the real mapper.
///
/// The URL each file came from is recorded in <c>Fixtures/NycDohmh/_urls.txt</c> so a reader can
/// re-fetch and see whether the source has changed underneath the tests.
/// </summary>
internal static class NycFixtures
{
    private static readonly DateTimeOffset FetchedAtUtc = new(2026, 7, 25, 12, 0, 0, TimeSpan.Zero);

    internal static string Directory =>
        Path.Combine(AppContext.BaseDirectory, "Fixtures", "NycDohmh");

    internal static IReadOnlyList<string> FileNames =>
    [
        "graded-a-with-violations.json",
        "graded-c.json",
        "grade-n-z-p.json",
        "no-violations-recorded.json",
        "never-inspected-sentinel.json",
        "closed-by-dohmh.json",
        "duplicate-rows.json",
    ];

    /// <summary>Every row of one fixture file, mapped. Unmappable rows are dropped, as in production.</summary>
    internal static IReadOnlyList<CanonicalRecord> Load(string fileName)
    {
        string path = Path.Combine(Directory, fileName);
        string json = File.ReadAllText(path);

        using JsonDocument document = JsonDocument.Parse(json);

        List<CanonicalRecord> records = [];

        foreach (JsonElement row in document.RootElement.EnumerateArray())
        {
            NycMapResult result = NycDohmhMapper.Map(row, row.GetRawText(), FetchedAtUtc);

            if (result.Record is not null)
            {
                records.Add(result.Record);
            }
        }

        return records;
    }

    /// <summary>Every fixture, concatenated — the input to the idempotency test.</summary>
    internal static IReadOnlyList<CanonicalRecord> LoadAll()
        => [.. FileNames.SelectMany(Load)];

    /// <summary>The raw rows of a fixture, for tests that need to assert on the source shape itself.</summary>
    internal static JsonDocument LoadRaw(string fileName)
        => JsonDocument.Parse(File.ReadAllText(Path.Combine(Directory, fileName)));
}
