namespace Freshline.Core.Queries;

public sealed record SourceHealth(string Source, DateOnly? LatestInspectionDate, DateTimeOffset? LastSuccessfulRunStartedUtc, DateTimeOffset? LastSuccessfulRunCompletedUtc, string? Scope);
public sealed record DataHealth(IReadOnlyList<SourceHealth> Sources, int Establishments, int Inspections, int MissingCoordinates);
public interface IDataHealthQueries
{
    Task<DataHealth> GetAsync(CancellationToken cancellationToken);
}
