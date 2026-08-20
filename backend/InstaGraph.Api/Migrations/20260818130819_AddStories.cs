using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InstaGraph.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddStories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SharedStoryId",
                table: "Messages",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Stories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    AuthorId = table.Column<int>(type: "int", nullable: false),
                    ImageUrl = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    Caption = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    CloseFriendsOnly = table.Column<bool>(type: "bit", nullable: false),
                    ViewCount = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Stories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Stories_Users_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StoryViews",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    StoryId = table.Column<int>(type: "int", nullable: false),
                    ViewerId = table.Column<int>(type: "int", nullable: false),
                    ViewedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoryViews", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StoryViews_Stories_StoryId",
                        column: x => x.StoryId,
                        principalTable: "Stories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StoryViews_Users_ViewerId",
                        column: x => x.ViewerId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Messages_SharedStoryId",
                table: "Messages",
                column: "SharedStoryId");

            migrationBuilder.CreateIndex(
                name: "IX_Stories_AuthorId_ExpiresAt",
                table: "Stories",
                columns: new[] { "AuthorId", "ExpiresAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Stories_ExpiresAt",
                table: "Stories",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_StoryViews_StoryId_ViewerId",
                table: "StoryViews",
                columns: new[] { "StoryId", "ViewerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StoryViews_ViewerId",
                table: "StoryViews",
                column: "ViewerId");

            migrationBuilder.AddForeignKey(
                name: "FK_Messages_Stories_SharedStoryId",
                table: "Messages",
                column: "SharedStoryId",
                principalTable: "Stories",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Messages_Stories_SharedStoryId",
                table: "Messages");

            migrationBuilder.DropTable(
                name: "StoryViews");

            migrationBuilder.DropTable(
                name: "Stories");

            migrationBuilder.DropIndex(
                name: "IX_Messages_SharedStoryId",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "SharedStoryId",
                table: "Messages");
        }
    }
}
