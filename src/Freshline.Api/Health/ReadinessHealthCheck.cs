using Freshline.Core.Queries;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Freshline.Api.Health;

/// <summary>
/// Reports whether this instance can serve traffic, by asking whether the store behind the read
/// path is reachable.
///
/// <para>It goes through <see cref="IReadinessProbe"/> rather than touching a <c>DbContext</c>,
/// because this project is not allowed to know that a <c>DbContext</c> is what is behind it.</para>
/// </summary>
internal sealed class ReadinessHealthCheck(IReadinessProbe probe) : IHealthCheck
{
    /// <summary>Checks carrying this tag run on the readiness endpoint and not on liveness.</summary>
    public const string ReadyTag = "ready";

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        bool ready = await probe.IsReadyAsync(cancellationToken);

        return ready
            ? HealthCheckResult.Healthy("The database answered.")
            // Unhealthy, not Degraded. A read-only API with no reachable database cannot serve a
            // single one of its endpoints, so there is nothing degraded about it.
            : HealthCheckResult.Unhealthy("The database could not be reached.");
    }
}
