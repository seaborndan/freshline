using Freshline.Core.Queries;
using Microsoft.EntityFrameworkCore;

namespace Freshline.Infrastructure.Persistence;

/// <summary>
/// Answers <see cref="IReadinessProbe"/> by opening a connection to the database.
///
/// <para><c>CanConnectAsync</c> rather than a <c>SELECT 1</c> against a table: the question is
/// whether the store is reachable, and a query against a specific table would also fail if that
/// table were missing, which is a different problem wanting a different response. It swallows the
/// connection exception and returns false, which is what makes it a probe rather than a
/// query.</para>
/// </summary>
internal sealed class ReadinessProbe(FreshlineDbContext dbContext) : IReadinessProbe
{
    public Task<bool> IsReadyAsync(CancellationToken cancellationToken)
        => dbContext.Database.CanConnectAsync(cancellationToken);
}
