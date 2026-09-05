using Freshline.Core.Queries;
using Freshline.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Freshline.Infrastructure.Queries;

internal sealed class ProspectQueries(FreshlineDbContext db) : IProspectQueries
{
    // Narrow, traceable NYC signals: mice, flies/other nuisance pests, and harborage conditions.
    // This is a prospecting filter, not a new grade or a claim that an issue remains unresolved.
    private static readonly string[] Codes = ["04L", "04N", "08A"];

    public async Task<ProspectResult> FindAsync(
        string? locality, DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        // Choose the latest inspection BEFORE applying the date range or violation filter.
        // Otherwise an older pest citation could be presented despite a newer clean inspection.
        var matches = db.Inspections.AsNoTracking().Where(i =>
            i.Establishment != null &&
            (locality == null || i.Establishment.Locality == locality) &&
            i.InspectedOn >= from && i.InspectedOn <= to &&
            !db.Inspections.Any(newer => newer.EstablishmentId == i.EstablishmentId &&
                (newer.InspectedOn > i.InspectedOn || (newer.InspectedOn == i.InspectedOn && newer.Id > i.Id))) &&
            i.Violations.Any(v => Codes.Contains(v.Code)));

        var rows = await matches.OrderByDescending(i => i.InspectedOn).ThenBy(i => i.EstablishmentId)
            .Select(i => new
            {
                Id = i.EstablishmentId,
                Name = i.Establishment == null ? "" : i.Establishment.Name,
                Address = i.Establishment == null ? null : i.Establishment.AddressLine,
                Locality = i.Establishment == null ? null : i.Establishment.Locality,
                Phone = i.Establishment == null ? null : i.Establishment.Phone,
                i.InspectedOn,
                Evidence = i.Violations.Where(v => Codes.Contains(v.Code))
                    .OrderBy(v => v.Code).Select(v => new ProspectEvidence(v.Code, v.Description)).ToList(),
            }).Take(201).ToListAsync(cancellationToken);

        return new ProspectResult(rows.Take(200).Select(r => new Prospect(
            r.Id, r.Name, r.Address, r.Locality, r.Phone, r.InspectedOn, r.Evidence)).ToList(), rows.Count > 200);
    }
}
