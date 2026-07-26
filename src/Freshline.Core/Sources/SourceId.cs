namespace Freshline.Core.Sources;

/// <summary>
/// The data sources Freshline ingests from. Values are assigned explicitly and never
/// reused: they are persisted as the first half of every row's natural key, so renumbering
/// one would silently re-point existing data at a different city.
/// </summary>
public enum SourceId
{
    /// <summary>New York City Department of Health and Mental Hygiene restaurant inspections.</summary>
    NycDohmh = 1,
}
