using Freshline.Core.Ingestion;
using Freshline.Core.Sources;
using Microsoft.Extensions.Options;

namespace Freshline.Ingestion;

/// <summary>
/// Drives ingestion on a schedule. Orchestration only — what to fetch and how to translate it
/// lives in Infrastructure, so all of it is testable without a host.
/// </summary>
public class Worker(
    IServiceScopeFactory scopeFactory,
    IHostApplicationLifetime lifetime,
    IOptions<IngestionScheduleOptions> options,
    ILogger<Worker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        IngestionScheduleOptions schedule = options.Value;

        while (!stoppingToken.IsCancellationRequested)
        {
            // A scope per pass, because the DbContext is scoped and a long-lived one would
            // accumulate every entity it had ever tracked for the lifetime of the process.
            using IServiceScope scope = scopeFactory.CreateScope();
            IIngestionRunner runner = scope.ServiceProvider.GetRequiredService<IIngestionRunner>();

            try
            {
                IngestionRunResult result = await runner.RunAsync(SourceId.NycDohmh, stoppingToken);

                logger.LogInformation(
                    "Ingestion complete for {Source}: {Fetched} fetched, {Deduplicated} after dedupe, " +
                    "{Establishments} establishments inserted, {Inspections} inspections inserted, " +
                    "{Violations} violations inserted. Watermark now {Watermark}.",
                    result.SourceId, result.RecordsFetched, result.RecordsDeduplicated,
                    result.EstablishmentsInserted, result.InspectionsInserted,
                    result.ViolationsInserted, result.WatermarkAfter);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                // A failed pass must not kill the worker. The watermark is only advanced inside
                // the run's transaction, so a failure leaves it where it was and the next pass
                // re-reads the same window rather than skipping it.
                logger.LogError(exception, "Ingestion failed for {Source}", SourceId.NycDohmh);

                if (schedule.RunOnce)
                {
                    throw;
                }
            }

            if (schedule.RunOnce)
            {
                lifetime.StopApplication();
                return;
            }

            await Task.Delay(schedule.Interval, stoppingToken);
        }
    }
}
