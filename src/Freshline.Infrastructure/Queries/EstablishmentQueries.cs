using Freshline.Core.Queries;
using Freshline.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Freshline.Infrastructure.Queries;

/// <summary>
/// The Entity Framework implementation of the read path. Internal on purpose: the API resolves
/// <see cref="IEstablishmentQueries"/> and has no way to name this class.
/// </summary>
internal sealed class EstablishmentQueries(FreshlineDbContext dbContext) : IEstablishmentQueries
{
    public Task<EstablishmentDetail?> GetAsync(int id, CancellationToken cancellationToken)
        => dbContext.Establishments
            .Where(establishment => establishment.Id == id)
            .Select(establishment => new EstablishmentDetail
            {
                Id = establishment.Id,
                Name = establishment.Name,
                Cuisine = establishment.Cuisine,
                Phone = establishment.Phone,
                AddressLine = establishment.AddressLine,
                Locality = establishment.Locality,
                PostalCode = establishment.PostalCode,
                Latitude = establishment.Latitude,
                Longitude = establishment.Longitude,
                IsAwaitingFirstInspection = establishment.IsAwaitingFirstInspection,
                Inspections = establishment.Inspections
                    .OrderByDescending(inspection => inspection.InspectedOn)
                    // A tiebreaker, so two inspections on the same date come back in the same order
                    // every time. Without it the order is whatever the plan happens to produce,
                    // which is stable in practice and therefore fails only under a new plan.
                    .ThenByDescending(inspection => inspection.Id)
                    .Select(inspection => new InspectionDetail
                    {
                        Id = inspection.Id,
                        InspectedOn = inspection.InspectedOn,
                        InspectionType = inspection.InspectionType,
                        Action = inspection.Action,
                        RawGrade = inspection.RawGrade,
                        RawScore = inspection.RawScore,
                        Outcome = inspection.Outcome,
                        NormalisedSeverity = inspection.NormalisedSeverity,
                        ClosedByAuthority = inspection.ClosedByAuthority,
                        Violations = inspection.Violations
                            .OrderBy(violation => violation.Code)
                            .Select(violation => new ViolationDetail
                            {
                                Code = violation.Code,
                                Description = violation.Description,
                                IsCritical = violation.IsCritical,
                            })
                            .ToList(),
                    })
                    .ToList(),
            })
            // FirstOrDefault, not SingleOrDefault. Single asks the database for two rows so it can
            // prove there was only one; on a primary-key lookup the key already guarantees that, so
            // the extra row buys nothing.
            .FirstOrDefaultAsync(cancellationToken);

    // Two things deliberately absent from the query above, both worth being able to explain:
    //
    // AsNoTracking() is not here because it would do nothing. The change tracker holds entities;
    // this projects to read models, which are not entities, so there is nothing to track. Adding
    // the call would suggest it was load-bearing. A test asserts the tracker stays empty.
    //
    // AsSplitQuery() is not here because the nesting is small and bounded. EF issues one query with
    // joins, so an establishment's rows multiply out to (inspections x violations). Measured
    // against the real data, the worst case is 9 inspections and 18 violations on one inspection —
    // a few hundred rows. Splitting into three round trips would cost more than the duplication it
    // avoids. That reasoning depends on the shape of this data and should be re-checked if a source
    // with deeper history is ever added.
}
