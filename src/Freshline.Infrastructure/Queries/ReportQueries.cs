using Freshline.Core.Model;
using Freshline.Core.Queries;
using Freshline.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Freshline.Infrastructure.Queries;

/// <summary>
/// The Entity Framework implementation of the aggregate read path. Internal, like the establishment
/// queries beside it: the API resolves the interface and cannot name this class.
/// </summary>
internal sealed class ReportQueries(FreshlineDbContext dbContext) : IReportQueries
{
    public async Task<OutcomeBreakdown> GetOutcomeBreakdownAsync(
        OutcomeBreakdownQuery query,
        CancellationToken cancellationToken)
    {
        IQueryable<Establishment> establishments = dbContext.Establishments;

        // Filters narrow the population before grouping. Cuisine can be applied while grouping by
        // locality and vice versa, which is what makes "poor results by cuisine, in Queens only" a
        // question this one report can answer.
        if (query.Locality is not null)
        {
            establishments = establishments.Where(e => e.Locality == query.Locality);
        }

        if (query.Cuisine is not null)
        {
            establishments = establishments.Where(e => e.Cuisine == query.Cuisine);
        }

        // Establishments whose grouping column is null cannot appear in any row. Counted rather than
        // dropped silently, so a reader can reconcile the table against the dataset totals — the gap
        // is 3,605 for cuisine and 66 for locality, which is far too large to leave unexplained.
        int ungrouped = await establishments
            .CountAsync(
                query.Dimension == ReportDimension.Locality
                    ? e => e.Locality == null
                    : e => e.Cuisine == null,
                cancellationToken);

        IQueryable<Establishment> grouped = query.Dimension == ReportDimension.Locality
            ? establishments.Where(e => e.Locality != null)
            : establishments.Where(e => e.Cuisine != null);

        /*
         * One row per establishment, carrying the group it belongs to and its latest counted outcome.
         *
         * The ordering inside the subquery is (InspectedOn descending, Id descending), matching the
         * detail query exactly. The tiebreaker is not decoration: without it, two inspections on the
         * same date come back in whatever order the plan produces, so an establishment inspected
         * twice in a day could land in a different column between two runs of the same report.
         *
         * The date range is applied *inside* this subquery rather than as a filter on establishments.
         * That is the whole semantic difference described on OutcomeBreakdownQuery.InspectedFrom:
         * inside, it means "the latest inspection within the period", which is what a report about a
         * period should say. Outside, it would mean "establishments whose all-time latest inspection
         * happens to fall in the period", which answers a question nobody asks.
         *
         * The correlated subquery is what the covering index on (EstablishmentId, InspectedOn DESC)
         * INCLUDE (Outcome, ...) exists for — the same index M3 built and M4 widened. Cost is
         * measured rather than assumed; see docs/performance.md.
         */
        var perEstablishment = grouped.Select(e => new
        {
            Group = query.Dimension == ReportDimension.Locality ? e.Locality! : e.Cuisine!,
            e.IsAwaitingFirstInspection,
            Outcome = e.Inspections
                .Where(i =>
                    (query.InspectedFrom == null || i.InspectedOn >= query.InspectedFrom) &&
                    (query.InspectedTo == null || i.InspectedOn <= query.InspectedTo))
                .OrderByDescending(i => i.InspectedOn)
                .ThenByDescending(i => i.Id)
                .Select(i => (InspectionOutcome?)i.Outcome)
                .FirstOrDefault(),
        });

        var counted = await perEstablishment
            .GroupBy(row => row.Group)
            .Select(group => new
            {
                Group = group.Key,
                Total = group.Count(),

                // Never inspected at all, which is the establishment's own published state and does
                // not depend on the date range. NoInspectionInPeriod below is the other thing.
                NeverInspected = group.Count(row => row.IsAwaitingFirstInspection),

                // Has inspections, none of them counted. Derived as "no outcome and not awaiting a
                // first inspection" rather than counted directly, because the two together must
                // account for every establishment without an outcome and deriving one of them
                // guarantees that.
                WithoutOutcome = group.Count(row => row.Outcome == null),

                Good = group.Count(row => row.Outcome == InspectionOutcome.Good),
                Fair = group.Count(row => row.Outcome == InspectionOutcome.Fair),
                Poor = group.Count(row => row.Outcome == InspectionOutcome.Poor),
                Ungraded = group.Count(row => row.Outcome == InspectionOutcome.Ungraded),
                PendingReinspection = group.Count(
                    row => row.Outcome == InspectionOutcome.PendingReinspection),
            })
            .ToListAsync(cancellationToken);

        List<OutcomeBreakdownRow> rows = counted
            .Select(row => new OutcomeBreakdownRow
            {
                Group = row.Group,
                Total = row.Total,
                NeverInspected = row.NeverInspected,

                // Never negative: an establishment awaiting its first inspection has no outcome, so
                // NeverInspected is always a subset of WithoutOutcome. Max is belt and braces around
                // an invariant, and if it ever bites, the two counts disagree and the report is
                // wrong in a way worth finding.
                NoInspectionInPeriod = Math.Max(0, row.WithoutOutcome - row.NeverInspected),

                Good = row.Good,
                Fair = row.Fair,
                Poor = row.Poor,
                Ungraded = row.Ungraded,
                PendingReinspection = row.PendingReinspection,
            })

            // Worst first, by what the evidence supports rather than by the observed rate — ADR-0007.
            // Ties break on the group name so the order is total and a report run twice looks the
            // same twice.
            .OrderByDescending(row => row.PoorShare.SupportedAtLeast)
            .ThenBy(row => row.Group, StringComparer.Ordinal)
            .ToList();

        return new OutcomeBreakdown
        {
            Dimension = query.Dimension,
            Rows = rows,
            UngroupedEstablishments = ungrouped,
            HasDateRange = query.HasDateRange,
        };
    }
}
