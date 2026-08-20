using System.ComponentModel.DataAnnotations;

namespace InstaGraph.Api.DTOs;

/// <summary>One photo in somebody's story.</summary>
public record StoryResponse
{
    public int Id { get; init; }
    public UserSummary Author { get; init; } = new();

    public string ImageUrl { get; init; } = string.Empty;
    public string Caption { get; init; } = string.Empty;

    public bool CloseFriendsOnly { get; init; }

    public bool IsMine { get; init; }

    /// <summary>You have already opened this one. Drives the grey ring rather than the gradient.</summary>
    public bool IsSeen { get; init; }

    /// <summary>Only ever filled in for the author. Nobody else is told how many people looked.</summary>
    public int ViewCount { get; init; }

    public DateTime CreatedAt { get; init; }
    public DateTime ExpiresAt { get; init; }
}

/// <summary>
/// One ring in the row across the top of the feed: an account and everything of theirs still alive.
/// </summary>
public record StoryTrayItem
{
    public UserSummary User { get; init; } = new();

    public int StoryCount { get; init; }

    /// <summary>At least one you have not opened. This is what makes the ring a gradient.</summary>
    public bool HasUnseen { get; init; }

    public bool IsMine { get; init; }

    /// <summary>The first photo, so the ring can be filled in before the viewer opens anything.</summary>
    public string PreviewUrl { get; init; } = string.Empty;

    public DateTime LatestAt { get; init; }

    /// <summary>Every story of theirs you are allowed to see, oldest first — the order they are shown in.</summary>
    public IReadOnlyList<StoryResponse> Stories { get; init; } = [];
}

public record CreateStoryRequest
{
    [Required]
    public IFormFile Image { get; init; } = null!;

    [StringLength(300)]
    public string Caption { get; init; } = string.Empty;

    /// <summary>Narrows the audience from every follower to your close-friends list.</summary>
    public bool CloseFriendsOnly { get; init; }
}

/// <summary>Somebody who opened your story, newest first.</summary>
public record StoryViewer
{
    public UserSummary User { get; init; } = new();
    public DateTime ViewedAt { get; init; }

    /// <summary>Whether they follow you — the same flag every other list of people carries.</summary>
    public bool FollowsYou { get; init; }

    public bool IsFollowing { get; init; }
}

public record StoryReplyRequest
{
    [Required, StringLength(2000, MinimumLength = 1)]
    public string Text { get; init; } = string.Empty;
}

/// <summary>
/// A named group of stories kept on a profile after the day they were posted.
/// </summary>
public record StoryHighlightResponse
{
    public int Id { get; init; }
    public string Title { get; init; } = string.Empty;
    public string? CoverUrl { get; init; }
    public int StoryCount { get; init; }
    public bool IsMine { get; init; }
    public DateTime CreatedAt { get; init; }

    /// <summary>
    /// Oldest first, the way a highlight plays. Empty on the profile listing and filled in only when one
    /// is opened — a profile with twelve highlights should not carry every photo in all of them.
    /// </summary>
    public IReadOnlyList<StoryResponse> Stories { get; init; } = [];
}

public record CreateHighlightRequest
{
    [Required, StringLength(40, MinimumLength = 1)]
    public string Title { get; init; } = string.Empty;

    /// <summary>The stories to open it with. They must be yours; expired ones are exactly the point.</summary>
    public List<int> StoryIds { get; init; } = [];
}

public record UpdateHighlightRequest
{
    [StringLength(40, MinimumLength = 1)]
    public string? Title { get; init; }

    /// <summary>Which story's photo to draw on the circle. Must already be in the highlight.</summary>
    public int? CoverStoryId { get; init; }

    /// <summary>
    /// The whole contents, replacing what is there. Left null to change the title alone.
    /// </summary>
    public List<int>? StoryIds { get; init; }
}
