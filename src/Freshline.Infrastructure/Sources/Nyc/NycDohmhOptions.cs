using System.ComponentModel.DataAnnotations;

namespace Freshline.Infrastructure.Sources.Nyc;

public sealed class NycDohmhOptions
{
    public const string SectionName = "Sources:NycDohmh";

    [Required]
    public string BaseAddress { get; set; } = "https://data.cityofnewyork.us/";

    /// <summary>The DOHMH Restaurant Inspection Results dataset.</summary>
    [Required]
    public string ResourcePath { get; set; } = "resource/43nn-pn8j.json";

    /// <summary>
    /// Restricts ingestion to one borough. M1 runs Staten Island: 9,587 rows all-time and 3,099
    /// in the last twelve months, which is small enough that the whole schema-and-idempotency
    /// loop runs in seconds. Set to null to ingest the whole city.
    /// </summary>
    public string? Borough { get; set; } = "Staten Island";

    /// <summary>
    /// The earliest inspection date this deployment will ever request. Bounds the first run and
    /// stops the lookback walking backwards out of scope on later ones.
    /// </summary>
    [Required]
    public DateOnly BackfillFloor { get; set; } = new(2025, 7, 25);

    /// <summary>
    /// How many days before the watermark each run re-reads.
    ///
    /// <strong>This is an assumption, not a measurement.</strong> NYC restates rows in place and
    /// publishes no per-row change timestamp, so some overlap is required — but nothing has
    /// established how far back restatements actually reach. 30 days is a guess chosen to be
    /// comfortably generous. Measuring the real distribution is a follow-up; until then this
    /// number should be read as "a value we can change", and it is not quoted anywhere as a finding.
    /// </summary>
    [Range(0, 365)]
    public int LookbackDays { get; set; } = 30;

    [Range(1, 50_000)]
    public int PageSize { get; set; } = 1_000;

    /// <summary>
    /// Optional Socrata application token. Unauthenticated requests are rate limited but
    /// entirely sufficient at this volume, which is why nothing here requires a secret to run.
    /// In Azure this comes from Key Vault via managed identity, never from configuration files.
    /// </summary>
    public string? AppToken { get; set; }
}
