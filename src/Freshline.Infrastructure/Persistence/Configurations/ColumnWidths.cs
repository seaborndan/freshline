namespace Freshline.Infrastructure.Persistence.Configurations;

/// <summary>
/// Column widths, sized from the longest value actually present in the source rather than
/// guessed. Measured against all 295,294 rows of the NYC dataset on 2026-07-25 with
/// <c>$select=max(length(field))</c>:
///
/// <code>
///   camis 8   dba 100   cuisine_description 30   phone 12   building 10   street 40
///   boro 13   zipcode 5   inspection_type 61   action 130   grade 1
///   violation_code 5   violation_description 952
/// </code>
///
/// Each constant below leaves roughly a factor of two of headroom over the measured maximum,
/// because a city is free to publish a longer value tomorrow and a truncation would be silent
/// data loss. They are not tight, and they are not arbitrary either.
/// </summary>
internal static class ColumnWidths
{
    /// <summary>NYC's longest derived key is about 86 characters: camis:date:inspection_type:code.</summary>
    internal const int ExternalId = 256;

    internal const int Name = 200;
    internal const int Cuisine = 64;
    internal const int Phone = 32;
    internal const int AddressLine = 128;
    internal const int Locality = 64;
    internal const int PostalCode = 16;
    internal const int InspectionType = 128;
    internal const int Action = 512;
    internal const int RawGrade = 8;
    internal const int ViolationCode = 32;
    internal const int ViolationDescription = 2048;
}
