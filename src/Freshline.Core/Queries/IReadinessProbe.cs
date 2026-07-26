namespace Freshline.Core.Queries;

/// <summary>
/// Whether the store behind the read path can actually be reached.
///
/// <para>This exists so the API can answer "am I ready to serve requests" without knowing what the
/// store is. The API project has no reference to Entity Framework and cannot ask a
/// <c>DbContext</c> anything; it asks this instead, and Infrastructure decides what the question
/// means.</para>
///
/// <para><strong>Why a readiness check separate from liveness.</strong> They answer different
/// questions and want different reactions. <em>Liveness</em> is "is this process alive" — if it
/// fails, restarting helps. <em>Readiness</em> is "can this instance serve traffic right now" — if
/// it fails because the database is unreachable, restarting the API changes nothing, and what
/// should happen instead is that the load balancer stops sending it requests. Collapsing the two
/// into one endpoint means either a health check that stays green while the database is down, or
/// a restart loop that cannot fix the actual problem.</para>
/// </summary>
public interface IReadinessProbe
{
    /// <summary>
    /// True when the store answered. Returns false rather than throwing on a connection failure:
    /// an unreachable database is the condition being reported, not an error in reporting it.
    /// </summary>
    Task<bool> IsReadyAsync(CancellationToken cancellationToken);
}
