namespace Freshline.Core.Model;

/// <summary>
/// The source-neutral result of an inspection. Cities publish incompatible vocabularies —
/// letter grades, pass/fail, placard colours — and this is the single scale they are all
/// translated onto so that nothing downstream needs to know which city a row came from.
///
/// Deliberately <em>not</em> derived from a numeric score. Verified against the NYC dataset:
/// score ranges overlap across grades badly enough that no threshold reproduces the published
/// grade. See ADR-0003.
/// </summary>
public enum InspectionOutcome
{
    /// <summary>
    /// No outcome published for this inspection. This is the majority case in NYC —
    /// 149,994 of 295,294 rows — and is a real state, not missing data.
    /// </summary>
    Ungraded = 0,

    /// <summary>Best published result. NYC grade A.</summary>
    Good = 1,

    /// <summary>Middling published result. NYC grade B.</summary>
    Fair = 2,

    /// <summary>Worst published result. NYC grade C.</summary>
    Poor = 3,

    /// <summary>
    /// Awaiting re-inspection, typically following a closure. NYC grade P. Distinct from
    /// <see cref="Ungraded"/> because it is an active regulatory state rather than an absence.
    /// </summary>
    PendingReinspection = 4,
}
