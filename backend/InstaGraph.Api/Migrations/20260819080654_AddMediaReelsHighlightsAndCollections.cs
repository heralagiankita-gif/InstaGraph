using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace InstaGraph.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMediaReelsHighlightsAndCollections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsVerified",
                table: "Users",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "CollectionId",
                table: "SavedPosts",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "CommentsDisabled",
                table: "Posts",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "HideCounts",
                table: "Posts",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsArchived",
                table: "Posts",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsPinned",
                table: "Posts",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsReel",
                table: "Posts",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "ViewCount",
                table: "Posts",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "Collections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OwnerId = table.Column<int>(type: "int", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    CoverUrl = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    ItemCount = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Collections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Collections_Users_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Highlights",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OwnerId = table.Column<int>(type: "int", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    CoverUrl = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Highlights", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Highlights_Users_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PostMedia",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PostId = table.Column<int>(type: "int", nullable: false),
                    Kind = table.Column<int>(type: "int", nullable: false),
                    Url = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    PosterUrl = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    Position = table.Column<int>(type: "int", nullable: false),
                    AspectRatio = table.Column<double>(type: "float", nullable: false),
                    DurationMs = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PostMedia", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PostMedia_Posts_PostId",
                        column: x => x.PostId,
                        principalTable: "Posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PostTags",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PostId = table.Column<int>(type: "int", nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    MediaPosition = table.Column<int>(type: "int", nullable: false),
                    X = table.Column<double>(type: "float", nullable: false),
                    Y = table.Column<double>(type: "float", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PostTags", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PostTags_Posts_PostId",
                        column: x => x.PostId,
                        principalTable: "Posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PostTags_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PostViews",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PostId = table.Column<int>(type: "int", nullable: false),
                    ViewerId = table.Column<int>(type: "int", nullable: false),
                    ViewedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PostViews", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PostViews_Posts_PostId",
                        column: x => x.PostId,
                        principalTable: "Posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PostViews_Users_ViewerId",
                        column: x => x.ViewerId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "HighlightStories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    HighlightId = table.Column<int>(type: "int", nullable: false),
                    StoryId = table.Column<int>(type: "int", nullable: false),
                    Position = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HighlightStories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HighlightStories_Highlights_HighlightId",
                        column: x => x.HighlightId,
                        principalTable: "Highlights",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_HighlightStories_Stories_StoryId",
                        column: x => x.StoryId,
                        principalTable: "Stories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SavedPosts_CollectionId",
                table: "SavedPosts",
                column: "CollectionId");

            migrationBuilder.CreateIndex(
                name: "IX_SavedPosts_UserId_CollectionId",
                table: "SavedPosts",
                columns: new[] { "UserId", "CollectionId" });

            migrationBuilder.CreateIndex(
                name: "IX_Posts_IsReel_CreatedAt",
                table: "Posts",
                columns: new[] { "IsReel", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Collections_OwnerId_Name",
                table: "Collections",
                columns: new[] { "OwnerId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Highlights_OwnerId_CreatedAt",
                table: "Highlights",
                columns: new[] { "OwnerId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_HighlightStories_HighlightId_StoryId",
                table: "HighlightStories",
                columns: new[] { "HighlightId", "StoryId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HighlightStories_StoryId",
                table: "HighlightStories",
                column: "StoryId");

            migrationBuilder.CreateIndex(
                name: "IX_PostMedia_PostId_Position",
                table: "PostMedia",
                columns: new[] { "PostId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PostTags_PostId_UserId",
                table: "PostTags",
                columns: new[] { "PostId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PostTags_UserId",
                table: "PostTags",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_PostViews_PostId_ViewerId",
                table: "PostViews",
                columns: new[] { "PostId", "ViewerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PostViews_ViewerId",
                table: "PostViews",
                column: "ViewerId");

            migrationBuilder.AddForeignKey(
                name: "FK_SavedPosts_Collections_CollectionId",
                table: "SavedPosts",
                column: "CollectionId",
                principalTable: "Collections",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SavedPosts_Collections_CollectionId",
                table: "SavedPosts");

            migrationBuilder.DropTable(
                name: "Collections");

            migrationBuilder.DropTable(
                name: "HighlightStories");

            migrationBuilder.DropTable(
                name: "PostMedia");

            migrationBuilder.DropTable(
                name: "PostTags");

            migrationBuilder.DropTable(
                name: "PostViews");

            migrationBuilder.DropTable(
                name: "Highlights");

            migrationBuilder.DropIndex(
                name: "IX_SavedPosts_CollectionId",
                table: "SavedPosts");

            migrationBuilder.DropIndex(
                name: "IX_SavedPosts_UserId_CollectionId",
                table: "SavedPosts");

            migrationBuilder.DropIndex(
                name: "IX_Posts_IsReel_CreatedAt",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "IsVerified",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CollectionId",
                table: "SavedPosts");

            migrationBuilder.DropColumn(
                name: "CommentsDisabled",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "HideCounts",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "IsArchived",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "IsPinned",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "IsReel",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "ViewCount",
                table: "Posts");
        }
    }
}
