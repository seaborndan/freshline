using System.Globalization;
using System.Runtime.CompilerServices;
using Freshline.Core.Ingestion;
using Freshline.Core.Sources;
using Freshline.Infrastructure.Sources.Socrata;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Freshline.Infrastructure.Sources.Nyc;

/// <summary>
/// Fetches NYC DOHMH restaurant inspections and hands back canonical records.
///
/// Orchestration only: the SoQL lives here, the translation lives in <see cref="NycDohmhMapper"/>,
/// and the split is what makes the translation testable without a network.
/// </summary>
public sealed class NycDohmhConnector(
    SocrataClient socrataClient,
    IOptions<NycDohmhOptions> options,
    TimeProvider timeProvider,
    ILogger<NycDohmhConnector> logger) : ISourceConnector
{
    public SourceId SourceId => SourceId.NycDohmh;

    /// <summary>
    /// Everything that changes which records are in scope: the dataset, the borough filter and the
    /// backfill floor. Deliberately excludes the lookback, which changes how far back a run
    /// re-reads but not which records exist in scope, and excludes the page size entirely.
    /// </summary>
    public string ScopeSignature
    {
        get
        {
            NycDohmhOptions settings = options.Value;
            string borough = settings.Borough ?? "*";
            string floor = settings.BackfillFloor.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

            return $"resource={settings.ResourcePath};borough={borough};floor={floor}";
        }
    }

    public IngestionWindow GetWindow(DateOnly? watermark)
    {
        NycDohmhOptions settings = options.Value;
        return IngestionWindow.FromWatermark(watermark, settings.BackfillFloor, settings.LookbackDays);
    }

    public async IAsyncEnumerable<CanonicalRecord> FetchAsync(
        IngestionWindow window,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        NycDohmhOptions settings = options.Value;

        SocrataQuery query = new()
        {
            Where = BuildWhereClause(window, settings.Borough),
            // ":id" is Socrata's own per-row identifier. Ordering on a business column would not
            // be a total order — thousands of rows share an inspection date — and offset paging
            // over a partial order skips and repeats rows at the page boundaries.
            Order = ":id",
            PageSize = settings.PageSize,
        };

        // One fetch time for the whole run. Provenance should say when the run happened, not
        // record a slightly different instant for every row in the same batch.
        DateTimeOffset fetchedAtUtc = timeProvider.GetUtcNow();

        logger.LogInformation(
            "Fetching NYC DOHMH from {From} (borough: {Borough}) with $where {Where}",
            window.From, settings.Borough ?? "all", query.Where);

        int skipped = 0;

        await foreach (SocrataRow row in socrataClient
            .QueryAsync(settings.ResourcePath, query, cancellationToken)
            .WithCancellation(cancellationToken))
        {
            NycMapResult result = NycDohmhMapper.Map(row.Element, row.RawText, fetchedAtUtc);

            if (result.Record is null)
            {
                skipped++;
                logger.LogWarning("Skipped a NYC row: {Reason}", result.SkipReason);
                continue;
            }

            yield return result.Record;
        }

        if (skipped > 0)
        {
            logger.LogWarning("Skipped {Skipped} unmappable NYC rows in this run", skipped);
        }
    }

    /// <summary>
    /// Builds the <c>$where</c>.
    ///
    /// The sentinel disjunction is the part that is easy to get wrong. Establishments that are
    /// permitted but never inspected are published with an inspection date of 1900-01-01, which
    /// sits below every window this connector will ever ask for — so a plain date filter would
    /// silently exclude the newly-licensed signal the product is partly built on. They are
    /// re-read on every run, which costs almost nothing and is correct: a row vanishes from that
    /// set precisely when the establishment is first inspected.
    /// </summary>
    internal static string BuildWhereClause(IngestionWindow window, string? borough)
    {
        string sentinel = FormatLiteral(NycDohmhMapper.NeverInspectedSentinel);

        string dateRange = $"inspection_date >= {FormatLiteral(window.From)}";

        if (window.To is not null)
        {
            dateRange += $" AND inspection_date <= {FormatLiteral(window.To.Value)}";
        }

        string clause = $"(({dateRange}) OR inspection_date = {sentinel})";

        if (!string.IsNullOrWhiteSpace(borough))
        {
            clause += $" AND boro = {EscapeLiteral(borough)}";
        }

        return clause;
    }

    private static string FormatLiteral(DateOnly date)
        => $"'{date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}T00:00:00'";

    /// <summary>SoQL escapes a single quote inside a string literal by doubling it.</summary>
    private static string EscapeLiteral(string value)
        => $"'{value.Replace("'", "''", StringComparison.Ordinal)}'";
}
