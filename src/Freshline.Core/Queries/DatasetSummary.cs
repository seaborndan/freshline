namespace Freshline.Core.Queries;

/// <summary>
/// What this dataset contains, in the few numbers worth putting in front of somebody who has just
/// arrived.
///
/// <para><strong>Why this is a query rather than constants in the front end.</strong> The landing
/// page states figures about the data — how many establishments, how many inspections, how recently
/// the city last inspected anything. Hard-coding them would make the page a claim that was true on
/// the day it was written and silently false after the next ingestion run. `CLAUDE.md` says never
/// invent a number; a number that was measured once and then left to drift is the slower version of
/// inventing one.</para>
///
/// <para><strong>What is deliberately not here.</strong> No rates, no percentages, no "average
/// score". Every one of those is a conclusion rather than a count, and conclusions drawn over a whole
/// city hide exactly the small-sample problems the reporting suite has to handle explicitly. This
/// type answers "what is in here", not "what does it mean".</para>
/// </summary>
public sealed class DatasetSummary
{
    /// <summary>Every establishment on record, including those never inspected.</summary>
    public required int EstablishmentCount { get; init; }

    /// <summary>
    /// Establishments the city lists and has never visited.
    ///
    /// <para>Called out separately because it is a published state rather than an absence in our
    /// records, and because it is large enough that omitting it would misrepresent the rest — a
    /// reader who assumes every establishment has a grade will read every other number wrongly.</para>
    /// </summary>
    public required int AwaitingFirstInspectionCount { get; init; }

    /// <summary>Every inspection on record, across every establishment.</summary>
    public required int InspectionCount { get; init; }

    /// <summary>Distinct boroughs present in the data.</summary>
    public required int LocalityCount { get; init; }

    /// <summary>Distinct cuisine descriptions present in the data.</summary>
    public required int CuisineCount { get; init; }

    /// <summary>
    /// The date of the most recent inspection in the data, or <see langword="null"/> when there are
    /// no inspections at all.
    ///
    /// <para><strong>This is "data as of", and it is not the same as "when we last ran ingestion".</strong>
    /// The city publishes on its own schedule, so a successful ingestion run that found nothing new
    /// leaves this unchanged — which is the honest thing for a reader to see. A freshness claim based
    /// on our own job history would say the data is current when the source has gone quiet.</para>
    ///
    /// <para>A <see cref="DateOnly"/> rather than a <see cref="DateTime"/>, because an inspection
    /// happened on a day in New York. Giving it a time and an offset would invite exactly the
    /// midnight-shift bug this project has been avoiding since the map's first slice.</para>
    /// </summary>
    public required DateOnly? LatestInspectionOn { get; init; }
}
