using Freshline.Core.Queries;
using Freshline.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Freshline.Infrastructure.Queries;

internal sealed class DataHealthQueries(FreshlineDbContext dbContext) : IDataHealthQueries
{
    public async Task<DataHealth> GetAsync(CancellationToken cancellationToken)
    {
        var watermarks = await dbContext.SourceWatermarks.AsNoTracking().ToListAsync(cancellationToken);
        var sources = watermarks.Select(w => new SourceHealth(w.SourceId.ToString(), w.HighWaterMark, w.LastRunStartedUtc, w.LastRunCompletedUtc, w.ScopeSignature)).ToArray();
        var establishments = await dbContext.Establishments.CountAsync(cancellationToken);
        var inspections = await dbContext.Inspections.CountAsync(cancellationToken);
        var missing = await dbContext.Establishments.CountAsync(e => e.Latitude == null || e.Longitude == null, cancellationToken);
        return new DataHealth(sources, establishments, inspections, missing);
    }
}
