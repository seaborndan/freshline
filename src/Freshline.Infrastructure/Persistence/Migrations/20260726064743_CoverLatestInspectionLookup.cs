using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Freshline.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CoverLatestInspectionLookup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Inspections_EstablishmentId_InspectedOn",
                table: "Inspections");

            migrationBuilder.CreateIndex(
                name: "IX_Inspections_EstablishmentId_InspectedOn",
                table: "Inspections",
                columns: new[] { "EstablishmentId", "InspectedOn" },
                descending: new[] { false, true })
                .Annotation("SqlServer:Include", new[] { "RawGrade", "NormalisedSeverity" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Inspections_EstablishmentId_InspectedOn",
                table: "Inspections");

            migrationBuilder.CreateIndex(
                name: "IX_Inspections_EstablishmentId_InspectedOn",
                table: "Inspections",
                columns: new[] { "EstablishmentId", "InspectedOn" });
        }
    }
}
