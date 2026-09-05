namespace Freshline.Core.Queries;

public sealed record ProspectEvidence(string Code, string? Description);

public sealed record Prospect(
    int Id, string Name, string? Address, string? Locality, string? Phone,
    DateOnly InspectedOn, IReadOnlyList<ProspectEvidence> Evidence);

public sealed record ProspectResult(IReadOnlyList<Prospect> Items, bool IsTruncated);

public interface IProspectQueries
{
    Task<ProspectResult> FindAsync(string? locality, DateOnly from, DateOnly to, CancellationToken cancellationToken);
}
