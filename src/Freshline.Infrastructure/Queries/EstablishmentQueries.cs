using Freshline.Core.Model;
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

    public async Task<EstablishmentPage> ListAsync(
        EstablishmentListQuery query,
        CancellationToken cancellationToken)
    {
        IQueryable<Establishment> establishments = dbContext.Establishments;

        // StartsWith translates to LIKE @prefix + '%', which an index on Name can seek on: the rows
        // that match share a leading edge, so the engine can find the first and read forwards. A
        // Contains search would translate to LIKE '%...%', which has no such edge and forces a scan
        // no index can prevent. That is why this filter is a prefix and not a search box.
        if (!string.IsNullOrWhiteSpace(query.NameStartsWith))
        {
            establishments = establishments.Where(
                establishment => establishment.Name.StartsWith(query.NameStartsWith));
        }

        if (!string.IsNullOrWhiteSpace(query.Cuisine))
        {
            establishments = establishments.Where(
                establishment => establishment.Cuisine == query.Cuisine);
        }

        if (!string.IsNullOrWhiteSpace(query.Locality))
        {
            establishments = establishments.Where(
                establishment => establishment.Locality == query.Locality);
        }

        if (query.IsAwaitingFirstInspection is { } awaiting)
        {
            establishments = establishments.Where(
                establishment => establishment.IsAwaitingFirstInspection == awaiting);
        }

        // Filtering on the *latest* inspection's outcome, not on whether any inspection had it. An
        // establishment that scored badly in 2024 and well in 2026 is a good establishment, and
        // Any() would answer the wrong question.
        if (query.Outcome is { } outcome)
        {
            establishments = establishments.Where(
                establishment => establishment.Inspections
                    .OrderByDescending(inspection => inspection.InspectedOn)
                    .ThenByDescending(inspection => inspection.Id)
                    .Select(inspection => (InspectionOutcome?)inspection.Outcome)
                    .FirstOrDefault() == outcome);
        }

        // The seek predicate — the whole of keyset pagination is this one WHERE clause.
        //
        // OFFSET 5000 makes the database produce and discard 5,000 rows to reach row 5,001, so the
        // cost of a page grows with how deep into the list it is. This asks instead for "the rows
        // after this specific position", which an index ordered the same way can seek straight to.
        //
        // Written as an OR rather than as (Name, Id) > (@name, @id), because SQL Server has no row
        // constructor in a comparison. The comparison itself runs in the database and therefore uses
        // the column's collation, which is the same collation the index is ordered by — so the
        // predicate and the index agree about what "after" means. Doing this comparison in C#
        // instead would use ordinal ordering and quietly disagree.
        if (query.After is { } after)
        {
            establishments = establishments.Where(
                establishment =>
                    string.Compare(establishment.Name, after.Name) > 0
                    || (establishment.Name == after.Name && establishment.Id > after.Id));
        }

        // One row more than asked for, purely to answer "is there a next page" without a second
        // query. If the extra row arrives, there is more; it is then dropped and never serialised.
        // The alternative — treating a full page as "probably more" — lies on the last page whenever
        // the total is an exact multiple of the page size.
        int probeSize = query.PageSize + 1;

        List<EstablishmentSummary> rows = await establishments
            .OrderBy(establishment => establishment.Name)
            .ThenBy(establishment => establishment.Id)
            .Take(probeSize)
            .Select(establishment => new EstablishmentSummary
            {
                Id = establishment.Id,
                Name = establishment.Name,
                Cuisine = establishment.Cuisine,
                Locality = establishment.Locality,
                Latitude = establishment.Latitude,
                Longitude = establishment.Longitude,
                IsAwaitingFirstInspection = establishment.IsAwaitingFirstInspection,

                // A correlated FirstOrDefault in the projection, which is a *left* join: an
                // establishment with no inspections stays in the result with a null here.
                //
                // This is the M3 correction. docs/performance.md measured this lookup as a CROSS
                // APPLY, which is an inner join — against the M3 viewport that silently dropped
                // 1,307 of 7,290 establishments, exactly the never-inspected ones the product's
                // greenfield signal depends on. The query ran, returned rows, and was wrong.
                LatestInspection = establishment.Inspections
                    .OrderByDescending(inspection => inspection.InspectedOn)
                    .ThenByDescending(inspection => inspection.Id)
                    .Select(inspection => new LatestInspectionSummary
                    {
                        InspectedOn = inspection.InspectedOn,
                        RawGrade = inspection.RawGrade,
                        Outcome = inspection.Outcome,
                        NormalisedSeverity = inspection.NormalisedSeverity,
                        ClosedByAuthority = inspection.ClosedByAuthority,
                    })
                    .FirstOrDefault(),
            })
            .ToListAsync(cancellationToken);

        bool hasMore = rows.Count == probeSize;

        if (hasMore)
        {
            rows.RemoveAt(rows.Count - 1);
        }

        return new EstablishmentPage
        {
            Items = rows,
            Next = hasMore && rows.Count > 0
                ? new EstablishmentCursor(rows[^1].Name, rows[^1].Id)
                : null,
        };
    }

    // Two things deliberately absent from the detail query above, both worth being able to explain:
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
