using System.ComponentModel.DataAnnotations;

namespace InstaGraph.Api.DTOs;

/// <summary>One photo or clip on a post, and its place in the run.</summary>
public record PostMediaResponse
{
    /// <summary>"Image" or "Video" — the player the client opens is chosen from this, not the file name.</summary>
    public string Kind { get; init; } = "Image";

    public string Url { get; init; } = string.Empty;

    /// <summary>The still frame drawn before a clip plays. Null on a photo.</summary>
    public string? PosterUrl { get; init; }

    public int Position { get; init; }

    /// <summary>Width divided by height, so the space is the right shape before the file arrives.</summary>
    public double AspectRatio { get; init; } = 1.0;

    public int DurationMs { get; init; }
}

/// <summary>Somebody named in the photo itself, and where on it their label sits.</summary>
public record PostTagResponse
{
    public UserSummary User { get; init; } = new();
    public int MediaPosition { get; init; }
    public double X { get; init; }
    public double Y { get; init; }
}

public record PostResponse
{
    public int Id { get; init; }
    public UserSummary Author { get; init; } = new();

    /// <summary>
    /// The cover. Still here, and still the only thing a grid cell or a notification row reads — a
    /// thumbnail should never have to load a carousel to draw itself.
    /// </summary>
    public string ImageUrl { get; init; } = string.Empty;

    /// <summary>
    /// Everything on the post, in the author's order. Always at least one item, so the client has a single
    /// path to render rather than one for carousels and another for the posts that came before them.
    /// </summary>
    public IReadOnlyList<PostMediaResponse> Media { get; init; } = [];

    public string Caption { get; init; } = string.Empty;
    public string? Location { get; init; }

    /// <summary>A video post. Appears in the vertical Reels feed as well as in the ordinary one.</summary>
    public bool IsReel { get; init; }

    public int LikeCount { get; init; }
    public int CommentCount { get; init; }

    /// <summary>Plays, counted once per viewer. Shown on a reel in place of the like count.</summary>
    public int ViewCount { get; init; }

    public bool IsLiked { get; init; }
    public bool IsSaved { get; init; }
    public bool IsMine { get; init; }

    /// <summary>The author closed this one post to comments.</summary>
    public bool CommentsDisabled { get; init; }

    /// <summary>The author hid the numbers on this one post. The author still sees them.</summary>
    public bool HideCounts { get; init; }

    public bool IsPinned { get; init; }

    /// <summary>Only ever true on your own posts — an archived post is not returned to anybody else.</summary>
    public bool IsArchived { get; init; }

    /// <summary>Accounts named in the photo, as opposed to @-mentioned in the caption.</summary>
    public IReadOnlyList<PostTagResponse> Tags { get; init; } = [];

    /// <summary>
    /// Whether the viewer follows the author — but only where the answer was actually worked out.
    /// <para>
    /// Null means "not asked here", and the client draws no follow button at all rather than guessing.
    /// A follow is a directed edge, so a button fed a default of <c>false</c> cheerfully offers to follow
    /// somebody you already follow; the only safe default is refusing to render one. Reels fills this in
    /// because its ranking already has the viewer's out-edges in hand, so it costs nothing there.
    /// </para>
    /// </summary>
    public bool? AuthorIsFollowed { get; init; }

    public IReadOnlyList<string> Hashtags { get; init; } = [];
    public DateTime CreatedAt { get; init; }

    /// <summary>
    /// Set only on the home feed, and only for the posts that came from beyond the accounts you follow —
    /// the client shows it as the small "Suggested for you" label above the photo.
    /// </summary>
    public string? SuggestedReason { get; init; }

    /// <summary>The two newest comments, so the feed card can preview them without a second call.</summary>
    public IReadOnlyList<CommentResponse> PreviewComments { get; init; } = [];
}

public record CreatePostRequest
{
    /// <summary>
    /// The photos and clips, in the order they are meant to be swiped through. One to ten of them.
    /// </summary>
    public List<IFormFile>? Media { get; init; }

    /// <summary>
    /// A single photo, under the field name the API has always used. Kept so that anything already
    /// posting one file carries on working; ignored when <see cref="Media"/> is present.
    /// </summary>
    public IFormFile? Image { get; init; }

    /// <summary>
    /// Poster frames for the clips — a still grabbed from the first frame by the browser doing the
    /// upload, since there is no video tooling on the server to grab one here.
    /// <para>
    /// Without one a video post has no thumbnail, and a grid cell cannot draw an image tag of an MP4.
    /// Aligned to <see cref="Media"/> by <see cref="PosterFor"/> rather than by position, because only
    /// some of the items have one.
    /// </para>
    /// </summary>
    public List<IFormFile>? Posters { get; init; }

    /// <summary>For each poster, which item of <see cref="Media"/> it belongs to.</summary>
    public List<int>? PosterFor { get; init; }

    /// <summary>Width divided by height of each item, measured by the browser. Parallel to <see cref="Media"/>.</summary>
    public List<double>? AspectRatios { get; init; }

    /// <summary>Length of each clip in milliseconds, zero for a photo. Parallel to <see cref="Media"/>.</summary>
    public List<int>? Durations { get; init; }

    [StringLength(2200)]
    public string Caption { get; init; } = string.Empty;

    [StringLength(120)]
    public string? Location { get; init; }

    /// <summary>Closes this one post to comments, whatever the account-wide audience allows.</summary>
    public bool CommentsDisabled { get; init; }

    /// <summary>Hides the numbers under this one post from everybody except its author.</summary>
    public bool HideCounts { get; init; }
}

/// <summary>One label on a photo: who, on which item of the carousel, and where.</summary>
public record PostTagRequest
{
    public int UserId { get; init; }

    public int MediaPosition { get; init; }

    [Range(0, 1)]
    public double X { get; init; } = 0.5;

    [Range(0, 1)]
    public double Y { get; init; } = 0.5;
}

/// <summary>
/// The whole set of labels on a post, replacing whatever was there. A set rather than an add and a
/// remove, because the editor sends the picture it is looking at and expects that to be what is stored.
/// </summary>
public record SetPostTagsRequest
{
    public List<PostTagRequest> Tags { get; init; } = [];
}

/// <summary>A folder inside the saved tab.</summary>
public record CollectionResponse
{
    public int Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? CoverUrl { get; init; }
    public int ItemCount { get; init; }
    public DateTime CreatedAt { get; init; }
}

public record CreateCollectionRequest
{
    [Required, StringLength(60, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;
}

/// <summary>Files a saved post into a folder, or out of one when the id is null.</summary>
public record FilePostRequest
{
    public int? CollectionId { get; init; }
}

public record CommentResponse
{
    public int Id { get; init; }
    public UserSummary Author { get; init; } = new();
    public string Text { get; init; } = string.Empty;
    public bool IsMine { get; init; }
    public DateTime CreatedAt { get; init; }

    /// <summary>Null for a top-level comment; otherwise the comment this one answers.</summary>
    public int? ParentId { get; init; }

    public int LikeCount { get; init; }
    public bool IsLiked { get; init; }
    public int ReplyCount { get; init; }

    /// <summary>Filled in on the thread view; empty on a reply, because threading stops at one level.</summary>
    public IReadOnlyList<CommentResponse> Replies { get; init; } = [];
}

public record CreateCommentRequest
{
    [Required, StringLength(1000, MinimumLength = 1)]
    public string Text { get; init; } = string.Empty;

    /// <summary>Set to answer an existing comment. A reply to a reply attaches to the same parent.</summary>
    public int? ParentId { get; init; }
}

public record UpdateCaptionRequest
{
    [StringLength(2200)]
    public string Caption { get; init; } = string.Empty;

    [StringLength(120)]
    public string? Location { get; init; }

    /// <summary>Left null to keep whatever the post already says.</summary>
    public bool? CommentsDisabled { get; init; }

    public bool? HideCounts { get; init; }
}

public record RelationshipResponse
{
    public bool IsBlocked { get; init; }
    public bool IsMuted { get; init; }
    public bool IsFollowing { get; init; }
}

public record LikeResponse
{
    public bool IsLiked { get; init; }
    public int LikeCount { get; init; }
}

public record SaveResponse
{
    public bool IsSaved { get; init; }
}

/// <summary>
/// One ring in the row across the top of the feed: somebody you follow who has posted in the last day,
/// and the photo to open when you tap them.
/// </summary>
public record HighlightResponse
{
    public UserSummary User { get; init; } = new();
    public int LatestPostId { get; init; }
    public string LatestImageUrl { get; init; } = string.Empty;
    public DateTime PostedAt { get; init; }
    public bool IsSeen { get; init; }
}

public record FollowResponse
{
    public bool IsFollowing { get; init; }
    public bool FollowRequested { get; init; }
    public int FollowerCount { get; init; }
}

/// <summary>A page of anything, with just enough to know whether to ask for more.</summary>
public record Page<T>
{
    public IReadOnlyList<T> Items { get; init; } = [];
    public int PageNumber { get; init; }
    public int PageSize { get; init; }
    public bool HasMore { get; init; }
}

public record HashtagResponse
{
    public string Tag { get; init; } = string.Empty;
    public int PostCount { get; init; }
}

public record NotificationResponse
{
    public int Id { get; init; }
    public string Kind { get; init; } = string.Empty;
    public UserSummary Actor { get; init; } = new();
    public int? PostId { get; init; }
    public string? PostImageUrl { get; init; }
    public bool IsRead { get; init; }
    public DateTime CreatedAt { get; init; }
}

public record SearchResponse
{
    public IReadOnlyList<UserSummary> Users { get; init; } = [];
    public IReadOnlyList<HashtagResponse> Hashtags { get; init; } = [];
}
