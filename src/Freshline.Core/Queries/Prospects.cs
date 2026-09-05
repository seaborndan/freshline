namespace Freshline.Core.Queries;

public sealed record ProspectEvidence(string Code, string? Description);

public sealed record Prospect(
    int Id, string Name, string? Address, string? Locality, string? Phone,
    DateOnly InspectedOn, IReadOnlyList<ProspectEvidence> Evidence);

public sealed record ProspectResult(IReadOnlyList<Prospect> Items, bool IsTruncated);

public sealed record OpportunityCategory(string Id, string Label, string Description, IReadOnlyList<string> Codes);

public static class OpportunityCategories
{
    public static IReadOnlyList<OpportunityCategory> All { get; } = [
        new("pest-control", "Pest control", "Mice, nuisance pests, or harborage conditions.", ["04L", "04N", "08A"]),
        new("sanitation", "Cleaning & sanitation", "Cleaning or sanitation citations on food-contact and other surfaces. Some citations also concern surface construction.", ["06D", "10F"]),
        new("temperature", "Food temperature control", "Cold food held above required temperatures. This can involve handling practices or equipment; it does not establish a refrigeration fault.", ["02G"]),
        new("facilities", "Plumbing & handwashing", "Drainage, backflow, wastewater, or handwashing-facility citations. Some concern supplies or access rather than repairs.", ["10B", "05D"]),
    ];

    public static string[] CodesFor(string category) => All
        .Where(c => category == "all" || c.Id == category).SelectMany(c => c.Codes).Distinct().ToArray();
}

public interface IProspectQueries
{
    Task<MapResult> MapAsync(int[] ids, CancellationToken cancellationToken);
    Task<ProspectResult> FindAsync(string category, string? locality, DateOnly from, DateOnly to, CancellationToken cancellationToken);
}
