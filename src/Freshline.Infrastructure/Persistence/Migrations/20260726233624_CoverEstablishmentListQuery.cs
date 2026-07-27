using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Freshline.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CoverEstablishmentListQuery : Migration
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
                .Annotation("SqlServer:Include", new[] { "RawGrade", "NormalisedSeverity", "Outcome", "ClosedByAuthority" });

            migrationBuilder.CreateIndex(
                name: "IX_Establishments_Name_Id",
                table: "Establishments",
                columns: new[] { "Name", "Id" })
                .Annotation("SqlServer:Include", new[] { "Cuisine", "Locality", "Latitude", "Longitude", "IsAwaitingFirstInspection" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Inspections_EstablishmentId_InspectedOn",
                table: "Inspections");

            migrationBuilder.DropIndex(
                name: "IX_Establishments_Name_Id",
                table: "Establishments");

            migrationBuilder.CreateIndex(
                name: "IX_Inspections_EstablishmentId_InspectedOn",
                table: "Inspections",
                columns: new[] { "EstablishmentId", "InspectedOn" },
                descending: new[] { false, true })
                .Annotation("SqlServer:Include", new[] { "RawGrade", "NormalisedSeverity" });
        }
    }
}
