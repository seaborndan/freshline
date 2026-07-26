using Freshline.Core.Model;
using NetTopologySuite.Geometries;

namespace Freshline.Infrastructure.Tests;

/// <summary>
/// The spatial equivalent of the grading-direction test.
///
/// NetTopologySuite takes (X, Y); for geographic coordinates that is longitude then latitude — the
/// reverse of how everyone says them and of how every open-data portal lists them. Swapping them
/// throws nothing, fails no query, and returns a valid distance for every pair of points. It just
/// moves every New York restaurant into the Southern Ocean.
/// </summary>
public class GeoPointTests
{
    // Central Park, roughly. Northern hemisphere, western hemisphere — so latitude is positive and
    // longitude negative, which makes a swap impossible to miss.
    private const double Latitude = 40.7829;
    private const double Longitude = -73.9654;

    [Fact]
    public void Longitude_goes_in_X_and_latitude_in_Y()
    {
        Point point = GeoPoint.FromLatitudeLongitude(Latitude, Longitude)!;

        Assert.Equal(Longitude, point.X);
        Assert.Equal(Latitude, point.Y);
    }

    [Fact]
    public void Points_are_tagged_with_WGS84()
    {
        Point point = GeoPoint.FromLatitudeLongitude(Latitude, Longitude)!;

        // SQL Server compares geographies only within a single SRID. Mixing them returns nulls from
        // spatial predicates rather than raising an error, so an unset SRID is a silent failure.
        Assert.Equal(4326, point.SRID);
        Assert.Equal(GeoPoint.Wgs84, point.SRID);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData(40.7829, null)]
    [InlineData(null, -73.9654)]
    public void A_missing_coordinate_yields_no_point(double? latitude, double? longitude)
        => Assert.Null(GeoPoint.FromLatitudeLongitude(latitude, longitude));

    /// <summary>
    /// A sanity check that does not depend on trusting the constructor: a point built from these
    /// coordinates must land in New York's quadrant of the globe. If the arguments were swapped the
    /// point would sit at latitude -73.97, which is in Antarctica.
    /// </summary>
    [Fact]
    public void A_New_York_establishment_lands_in_New_York()
    {
        Point point = GeoPoint.FromLatitudeLongitude(Latitude, Longitude)!;

        Assert.InRange(point.Y, 40.0, 41.0);    // latitude — New York
        Assert.InRange(point.X, -75.0, -73.0);  // longitude — New York
    }
}
