using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;

#nullable disable

namespace Freshline.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSpatialLocation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Establishments_Latitude_Longitude",
                table: "Establishments");

            migrationBuilder.AddColumn<Point>(
                name: "Location",
                table: "Establishments",
                type: "geography",
                nullable: true);

            // Backfill the rows that already exist. Without this the column is null for every
            // establishment ingested before this migration, and the spatial index below would be
            // built over nothing — it would still be created, still appear in the plan, and still
            // return no rows.
            //
            // Note the argument order. T-SQL's geography::Point takes (Latitude, Longitude);
            // NetTopologySuite's Point constructor takes (X, Y), which is (Longitude, Latitude).
            // The two APIs that write this same column take their coordinates in opposite orders.
            // Both are correct here, and a test pins the managed side.
            migrationBuilder.Sql("""
                UPDATE Establishments
                SET Location = geography::Point(Latitude, Longitude, 4326)
                WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL AND Location IS NULL;
                """);

            // EF's migration API cannot express CREATE SPATIAL INDEX, so this is raw SQL rather
            // than a HasIndex call that quietly produced a B-tree.
            //
            // GEOGRAPHY_AUTO_GRID lets SQL Server choose the tessellation density from the data
            // rather than taking four hand-picked grid levels, which would be four numbers guessed
            // rather than measured. CELLS_PER_OBJECT is left at its default for the same reason:
            // the point of M3 is to measure this, and tuning it before measuring would be
            // decoration.
            migrationBuilder.Sql("""
                CREATE SPATIAL INDEX SX_Establishments_Location
                ON Establishments (Location)
                USING GEOGRAPHY_AUTO_GRID;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The index has to go before the column it is built on, or the drop fails.
            migrationBuilder.Sql("DROP INDEX IF EXISTS SX_Establishments_Location ON Establishments;");

            migrationBuilder.DropColumn(
                name: "Location",
                table: "Establishments");

            migrationBuilder.CreateIndex(
                name: "IX_Establishments_Latitude_Longitude",
                table: "Establishments",
                columns: new[] { "Latitude", "Longitude" });
        }
    }
}
