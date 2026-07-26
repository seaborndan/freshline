using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Freshline.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWatermarkScopeSignature : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ScopeSignature",
                table: "SourceWatermarks",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ScopeSignature",
                table: "SourceWatermarks");
        }
    }
}
