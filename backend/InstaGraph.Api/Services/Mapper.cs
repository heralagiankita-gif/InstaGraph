using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;

namespace InstaGraph.Api.Services;

/// <summary>
/// Entity → DTO in one place. Entities are never returned from a controller, so the password hash cannot
/// leak by accident and the client's shape does not move every time a column does.
/// </summary>
public static class Mapper
{
    public static UserSummary ToSummary(this User user) => new()
    {
        Id = user.Id,
        Username = user.Username,
        FullName = user.FullName,
        AvatarUrl = user.AvatarUrl,
        IsPrivate = user.IsPrivate,
        IsVerified = user.IsVerified
    };

    public static CommentResponse ToResponse(
        this Comment comment,
        int viewerId,
        bool isLiked = false,
        IReadOnlyList<CommentResponse>? replies = null) => new()
    {
        Id = comment.Id,
        Author = comment.Author.ToSummary(),
        Text = comment.Text,
        IsMine = comment.AuthorId == viewerId,
        CreatedAt = comment.CreatedAt,
        ParentId = comment.ParentId,
        LikeCount = comment.LikeCount,
        IsLiked = isLiked,
        ReplyCount = comment.ReplyCount,
        Replies = replies ?? []
    };

    public static PostMediaResponse ToResponse(this PostMedia media) => new()
    {
        Kind = media.Kind.ToString(),
        Url = media.Url,
        PosterUrl = media.PosterUrl,
        Position = media.Position,
        AspectRatio = media.AspectRatio <= 0 ? 1.0 : media.AspectRatio,
        DurationMs = media.DurationMs
    };

    public static PostTagResponse ToResponse(this PostTag tag) => new()
    {
        User = tag.User.ToSummary(),
        MediaPosition = tag.MediaPosition,
        X = tag.X,
        Y = tag.Y
    };

    public static PostResponse ToResponse(
        this Post post,
        int viewerId,
        bool isLiked,
        IReadOnlyList<CommentResponse>? previewComments = null,
        string? suggestedReason = null,
        bool isSaved = false,
        bool? authorIsFollowed = null) => new()
    {
        Id = post.Id,
        Author = post.Author.ToSummary(),
        ImageUrl = post.ImageUrl,

        // A post made before media became a table has no rows to order, so its single photo is handed
        // over in the same shape a carousel of one would have. That way the client has one way to draw a
        // post rather than an old way and a new one, and neither the feed nor the grid has to ask which
        // era a row came from.
        Media = post.Media.Count > 0
            ? post.Media.OrderBy(m => m.Position).Select(m => m.ToResponse()).ToList()
            : [new PostMediaResponse { Kind = nameof(MediaKind.Image), Url = post.ImageUrl, Position = 0 }],

        Caption = post.Caption,
        Location = post.Location,
        IsReel = post.IsReel,
        LikeCount = post.LikeCount,
        CommentCount = post.CommentCount,
        ViewCount = post.ViewCount,
        IsLiked = isLiked,
        IsSaved = isSaved,
        IsMine = post.AuthorId == viewerId,
        CommentsDisabled = post.CommentsDisabled,
        HideCounts = post.HideCounts,
        IsPinned = post.IsPinned,
        IsArchived = post.IsArchived,
        Tags = post.Tags.Where(t => t.User is not null).Select(t => t.ToResponse()).ToList(),

        // Left null unless the caller genuinely knew, so no button is drawn on a guess.
        AuthorIsFollowed = post.AuthorId == viewerId ? null : authorIsFollowed,
        Hashtags = post.Hashtags.Select(h => h.Hashtag.Tag).ToList(),
        CreatedAt = post.CreatedAt,
        SuggestedReason = suggestedReason,
        PreviewComments = previewComments ?? []
    };

    public static StoryResponse ToResponse(this Story story, int viewerId, bool isSeen) => new()
    {
        Id = story.Id,
        Author = story.Author.ToSummary(),
        ImageUrl = story.ImageUrl,
        Caption = story.Caption,
        CloseFriendsOnly = story.CloseFriendsOnly,
        IsMine = story.AuthorId == viewerId,

        // Your own story always reads as seen, so your ring is never a gradient because of yourself.
        IsSeen = story.AuthorId == viewerId || isSeen,

        // Nobody but the author is told how many people looked.
        ViewCount = story.AuthorId == viewerId ? story.ViewCount : 0,
        CreatedAt = story.CreatedAt,
        ExpiresAt = story.ExpiresAt
    };

    public static NotificationResponse ToResponse(this Notification n) => new()
    {
        Id = n.Id,
        Kind = n.Kind.ToString(),
        Actor = n.Actor.ToSummary(),
        PostId = n.PostId,
        PostImageUrl = n.Post?.ImageUrl,
        IsRead = n.IsRead,
        CreatedAt = n.CreatedAt
    };
}
