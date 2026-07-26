namespace Freshline.Infrastructure.Sources.Socrata;

/// <summary>A SoQL query, minus the paging the client manages itself.</summary>
public sealed record SocrataQuery
{
    /// <summary>The <c>$where</c> clause, without the parameter name. Null fetches everything.</summary>
    public string? Where { get; init; }

    /// <summary>
    /// The <c>$order</c> clause. Required — see <see cref="SocrataClient.QueryAsync"/> for why
    /// paging without one is quietly wrong rather than merely untidy.
    /// </summary>
    public required string Order { get; init; }

    public required int PageSize { get; init; }
}
