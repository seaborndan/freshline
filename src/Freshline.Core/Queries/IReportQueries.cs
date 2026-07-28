namespace Freshline.Core.Queries;

/// <summary>
/// The aggregate read path — questions about the dataset rather than about a viewport.
///
/// <para><strong>Separate from <see cref="IEstablishmentQueries"/> on purpose.</strong> They differ
/// in every operational respect that matters: a map query is small, cheap, requested constantly and
/// stale within a pan; a report scans a large share of the table, is requested rarely, and its answer
/// is stable until the next ingestion run. Those differences drive different caching and different
/// rate limits, and a single interface would make "which of these is expensive" a question about
/// method names rather than about types.</para>
///
/// <para><strong>Named methods, not a query builder.</strong> Every report here is a question
/// somebody chose to ask, with a shape that can be indexed, measured and explained. See
/// `docs/milestones/m5b-landing-and-reporting.md` for why a generic builder was refused.</para>
/// </summary>
public interface IReportQueries
{
    /// <summary>
    /// How inspection results distribute across boroughs or across cuisines.
    ///
    /// <para>Each establishment contributes one outcome — its latest counted inspection — so the
    /// numbers count establishments rather than inspections.</para>
    /// </summary>
    Task<OutcomeBreakdown> GetOutcomeBreakdownAsync(
        OutcomeBreakdownQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// The establishments themselves, filtered, with their latest counted result.
    ///
    /// <para>The row-level counterpart to <see cref="GetOutcomeBreakdownAsync"/>: that one answers
    /// how results distribute, this one answers which places. Bounded rather than paged — see
    /// <see cref="EstablishmentReportQuery"/> for why a cursor cannot serve a sortable table.</para>
    /// </summary>
    Task<EstablishmentReport> GetEstablishmentsAsync(
        EstablishmentReportQuery query,
        CancellationToken cancellationToken);
}
