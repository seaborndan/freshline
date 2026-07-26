using System.ComponentModel.DataAnnotations;

namespace Freshline.Ingestion;

public sealed class IngestionScheduleOptions
{
    public const string SectionName = "Ingestion";

    /// <summary>
    /// Run one pass and exit, rather than looping. What CI and a manual backfill want; the
    /// deployed worker leaves it false.
    /// </summary>
    public bool RunOnce { get; set; }

    [Range(typeof(TimeSpan), "00:01:00", "24:00:00")]
    public TimeSpan Interval { get; set; } = TimeSpan.FromHours(6);

    /// <summary>
    /// Apply pending migrations at startup.
    ///
    /// Convenient locally and in CI, and off by default because it is the wrong shape for a
    /// deployed system: it grants the worker's runtime identity schema-modification rights, and
    /// it makes two instances starting at once a race. Real environments run migrations as a
    /// deliberate deployment step.
    /// </summary>
    public bool ApplyMigrationsOnStartup { get; set; }
}
