using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InstaGraph.Api.Migrations
{
    /// <inheritdoc />
    public partial class PasswordResetAndSessionRevocation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_EmailVerifications_Email_ConsumedAt",
                table: "EmailVerifications");

            migrationBuilder.AddColumn<DateTime>(
                name: "PasswordChangedAt",
                table: "Users",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Purpose",
                table: "EmailVerifications",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_EmailVerifications_Email_Purpose_ConsumedAt",
                table: "EmailVerifications",
                columns: new[] { "Email", "Purpose", "ConsumedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_EmailVerifications_Email_Purpose_ConsumedAt",
                table: "EmailVerifications");

            migrationBuilder.DropColumn(
                name: "PasswordChangedAt",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Purpose",
                table: "EmailVerifications");

            migrationBuilder.CreateIndex(
                name: "IX_EmailVerifications_Email_ConsumedAt",
                table: "EmailVerifications",
                columns: new[] { "Email", "ConsumedAt" });
        }
    }
}
