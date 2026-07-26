using Freshline.Core.Sources;
using NetTopologySuite.Geometries;

namespace Freshline.Core.Model;

/// <summary>
/// A food business, as identified by the city that licenses it. Identity is
/// (<see cref="SourceId"/>, <see cref="ExternalId"/>) — see ADR-0002 for why, and ADR-0003 for
/// what had to change once the data was actually read.
/// </summary>
public class Establishment
{
    public int Id { get; set; }

    public required SourceId SourceId { get; set; }

    /// <summary>The city's own identifier. NYC issues this as <c>camis</c>.</summary>
    public required string ExternalId { get; set; }

    public required string Name { get; set; }

    /// <summary>
    /// Cuisine as the source categorises it, unmapped. NYC publishes 90 distinct values.
    /// Not every source provides one.
    /// </summary>
    public string? Cuisine { get; set; }

    public string? Phone { get; set; }

    public string? AddressLine { get; set; }

    /// <summary>
    /// The sub-city area the source uses — borough in NYC, community area or ward elsewhere.
    /// Named generically because the canonical model must not carry one city's vocabulary.
    /// </summary>
    public string? Locality { get; set; }

    public string? PostalCode { get; set; }

    public double? Latitude { get; set; }

    public double? Longitude { get; set; }

    /// <summary>
    /// The establishment's position as a spatial point, stored as SQL Server <c>geography</c> with a
    /// spatial index. Null when the source published no usable coordinates.
    ///
    /// Duplicates <see cref="Latitude"/> and <see cref="Longitude"/> on purpose. Those two are the
    /// raw values as published, kept so a projection bug is fixable from stored data; this is the
    /// queryable form. It is derived from them on write, never edited independently.
    ///
    /// <para><strong>Coordinate order is the trap.</strong> A NetTopologySuite <see cref="Point"/>
    /// takes (X, Y) — that is <em>longitude first</em>, then latitude. Getting it backwards puts
    /// every New York restaurant somewhere in Antarctica while every query still runs and every
    /// distance still returns a number. It is pinned by a test, not by this comment.</para>
    ///
    /// <para>SRID 4326 is WGS 84 — the coordinate system GPS and every open-data portal publish in.
    /// Mixing SRIDs makes SQL Server return nulls from spatial predicates rather than errors.</para>
    /// </summary>
    public Point? Location { get; set; }

    /// <summary>
    /// True when the source has published this establishment but recorded no inspection for it.
    /// In NYC this arrives as a sentinel <c>inspection_date</c> of 1900-01-01 rather than as an
    /// absence, and it is a signal the product depends on, not a defect. See ADR-0003.
    /// </summary>
    public bool IsAwaitingFirstInspection { get; set; }

    public DateTimeOffset FirstSeenUtc { get; set; }

    public DateTimeOffset LastSeenUtc { get; set; }

    /// <summary>
    /// The raw source row this establishment's fields were most recently derived from.
    /// Provenance, per ADR-0002: a mapping bug should be fixable by re-normalising stored
    /// data rather than by re-fetching from every city.
    /// </summary>
    public long SourceRecordId { get; set; }

    public SourceRecord? SourceRecord { get; set; }

    public ICollection<Inspection> Inspections { get; set; } = [];
}
