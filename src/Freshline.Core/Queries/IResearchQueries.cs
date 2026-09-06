namespace Freshline.Core.Queries;
public sealed record ResearchCandidate(int Id, string Name, string? Address, string? Locality, string? Cuisine, DateOnly InspectedOn, string? InspectionType, IReadOnlyList<string> Codes);
public sealed record ResearchResult(IReadOnlyList<ResearchCandidate> Items, bool IsTruncated);
public interface IResearchQueries
{
    Task<ResearchResult> FindAsync(string? locality, string? cuisine, string[] codes, bool requireAll, bool prePermit, DateOnly from, DateOnly to, CancellationToken cancellationToken);
}
