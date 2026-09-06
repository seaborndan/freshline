using Freshline.Core.Queries;
using Freshline.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Freshline.Infrastructure.Queries;
internal sealed class ResearchQueries(FreshlineDbContext db) : IResearchQueries
{
    public async Task<ResearchResult> FindAsync(string? locality, string? cuisine, string[] codes, bool requireAll, bool prePermit, DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var query = db.Inspections.AsNoTracking().Where(i => i.Establishment != null &&
            (locality == null || i.Establishment.Locality == locality) && (cuisine == null || i.Establishment.Cuisine == cuisine) &&
            i.InspectedOn >= from && i.InspectedOn <= to &&
            (!prePermit || (i.InspectionType != null && i.InspectionType.StartsWith("Pre-permit"))) &&
            !db.Inspections.Any(newer => newer.EstablishmentId == i.EstablishmentId && (newer.InspectedOn > i.InspectedOn || (newer.InspectedOn == i.InspectedOn && newer.Id > i.Id))));
        if (codes.Length > 0)
        {
            if (requireAll)
            {
                foreach (var code in codes) query = query.Where(i => i.Violations.Any(v => v.Code == code));
            }
            else query = query.Where(i => i.Violations.Any(v => codes.Contains(v.Code)));
        }
        var rows = await query.OrderByDescending(i => i.InspectedOn).ThenBy(i => i.EstablishmentId)
            .Select(i => new ResearchCandidate(i.EstablishmentId, i.Establishment == null ? "" : i.Establishment.Name,
                i.Establishment == null ? null : i.Establishment.AddressLine, i.Establishment == null ? null : i.Establishment.Locality,
                i.Establishment == null ? null : i.Establishment.Cuisine, i.InspectedOn, i.InspectionType,
                i.Violations.OrderBy(v => v.Code).Select(v => v.Code).ToList())).Take(201).ToListAsync(cancellationToken);
        return new ResearchResult(rows.Take(200).ToArray(), rows.Count > 200);
    }
}
