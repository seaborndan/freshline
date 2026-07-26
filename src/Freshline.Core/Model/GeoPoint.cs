using NetTopologySuite.Geometries;

namespace Freshline.Core.Model;

/// <summary>
/// Builds spatial points from published latitude and longitude.
///
/// This exists so the coordinate order is written down exactly once. NetTopologySuite's
/// <see cref="Point"/> constructor takes (X, Y), and for geographic coordinates X is
/// <strong>longitude</strong> and Y is <strong>latitude</strong> — the opposite of the order
/// everybody says them in, and the opposite of the order every open-data portal lists them in.
///
/// Reversing them is the spatial equivalent of inverting the grading direction: nothing throws,
/// every query still runs, every distance still returns a number, and every New York restaurant
/// silently relocates to the Southern Ocean. It is pinned by a test.
/// </summary>
public static class GeoPoint
{
    /// <summary>
    /// WGS 84. The coordinate system GPS uses and that every open-data portal publishes in.
    /// SQL Server compares geographies only within one SRID; mixing them yields nulls from spatial
    /// predicates rather than errors, so it is set explicitly on every point rather than defaulted.
    /// </summary>
    public const int Wgs84 = 4326;

    /// <summary>
    /// Returns a point for the given coordinates, or null when either is missing.
    /// </summary>
    public static Point? FromLatitudeLongitude(double? latitude, double? longitude)
    {
        if (latitude is null || longitude is null)
        {
            return null;
        }

        // Longitude first. See the class summary.
        return new Point(longitude.Value, latitude.Value) { SRID = Wgs84 };
    }
}
