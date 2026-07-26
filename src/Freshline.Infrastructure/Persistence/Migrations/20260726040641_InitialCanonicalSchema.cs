using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Freshline.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCanonicalSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SourceRecords",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    SourceId = table.Column<int>(type: "int", nullable: false),
                    ExternalId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    FetchedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Payload = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourceRecords", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SourceWatermarks",
                columns: table => new
                {
                    SourceId = table.Column<int>(type: "int", nullable: false),
                    HighWaterMark = table.Column<DateOnly>(type: "date", nullable: true),
                    LastRunStartedUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    LastRunCompletedUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourceWatermarks", x => x.SourceId);
                });

            migrationBuilder.CreateTable(
                name: "Establishments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    SourceId = table.Column<int>(type: "int", nullable: false),
                    ExternalId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Cuisine = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    Phone = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    AddressLine = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    Locality = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    PostalCode = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    Latitude = table.Column<double>(type: "float", nullable: true),
                    Longitude = table.Column<double>(type: "float", nullable: true),
                    IsAwaitingFirstInspection = table.Column<bool>(type: "bit", nullable: false),
                    FirstSeenUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    LastSeenUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    SourceRecordId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Establishments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Establishments_SourceRecords_SourceRecordId",
                        column: x => x.SourceRecordId,
                        principalTable: "SourceRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Inspections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    SourceId = table.Column<int>(type: "int", nullable: false),
                    ExternalId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    EstablishmentId = table.Column<int>(type: "int", nullable: false),
                    InspectedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    InspectionType = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    Action = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: true),
                    RawGrade = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: true),
                    RawScore = table.Column<int>(type: "int", nullable: true),
                    Outcome = table.Column<int>(type: "int", nullable: false),
                    NormalisedSeverity = table.Column<int>(type: "int", nullable: true),
                    ClosedByAuthority = table.Column<bool>(type: "bit", nullable: false),
                    FetchedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    SourceRecordId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Inspections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Inspections_Establishments_EstablishmentId",
                        column: x => x.EstablishmentId,
                        principalTable: "Establishments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Inspections_SourceRecords_SourceRecordId",
                        column: x => x.SourceRecordId,
                        principalTable: "SourceRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Violations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    SourceId = table.Column<int>(type: "int", nullable: false),
                    ExternalId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    InspectionId = table.Column<int>(type: "int", nullable: false),
                    Code = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(2048)", maxLength: 2048, nullable: true),
                    IsCritical = table.Column<bool>(type: "bit", nullable: true),
                    FetchedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    SourceRecordId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Violations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Violations_Inspections_InspectionId",
                        column: x => x.InspectionId,
                        principalTable: "Inspections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Violations_SourceRecords_SourceRecordId",
                        column: x => x.SourceRecordId,
                        principalTable: "SourceRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Establishments_Latitude_Longitude",
                table: "Establishments",
                columns: new[] { "Latitude", "Longitude" });

            migrationBuilder.CreateIndex(
                name: "IX_Establishments_SourceRecordId",
                table: "Establishments",
                column: "SourceRecordId");

            migrationBuilder.CreateIndex(
                name: "UX_Establishments_SourceId_ExternalId",
                table: "Establishments",
                columns: new[] { "SourceId", "ExternalId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Inspections_EstablishmentId_InspectedOn",
                table: "Inspections",
                columns: new[] { "EstablishmentId", "InspectedOn" });

            migrationBuilder.CreateIndex(
                name: "IX_Inspections_SourceRecordId",
                table: "Inspections",
                column: "SourceRecordId");

            migrationBuilder.CreateIndex(
                name: "UX_Inspections_SourceId_ExternalId",
                table: "Inspections",
                columns: new[] { "SourceId", "ExternalId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_SourceRecords_SourceId_ExternalId",
                table: "SourceRecords",
                columns: new[] { "SourceId", "ExternalId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Violations_InspectionId",
                table: "Violations",
                column: "InspectionId");

            migrationBuilder.CreateIndex(
                name: "IX_Violations_SourceId_Code",
                table: "Violations",
                columns: new[] { "SourceId", "Code" });

            migrationBuilder.CreateIndex(
                name: "IX_Violations_SourceRecordId",
                table: "Violations",
                column: "SourceRecordId");

            migrationBuilder.CreateIndex(
                name: "UX_Violations_SourceId_ExternalId",
                table: "Violations",
                columns: new[] { "SourceId", "ExternalId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SourceWatermarks");

            migrationBuilder.DropTable(
                name: "Violations");

            migrationBuilder.DropTable(
                name: "Inspections");

            migrationBuilder.DropTable(
                name: "Establishments");

            migrationBuilder.DropTable(
                name: "SourceRecords");
        }
    }
}
