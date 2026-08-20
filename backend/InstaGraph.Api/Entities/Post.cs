namespace InstaGraph.Api.Entities;

public class Post
{
    public int Id { get; set; }

    public int AuthorId { get; set; }
    public User Author { get; set; } = null!;

    public string Caption { get; set; } = string.Empty;

    /// <summary>
    /// The cover: relative path to the first item, e.g. <c>/uploads/9f3c.jpg</c>, or a video's poster
    /// frame. Always present — this is a photo app, so a post without something to look at is not a post.
    /// <para>
    /// The run of media lives in <see cref="Media"/>. This stays because most of the app only ever wants
    /// one picture — a grid cell, a notification row, a post shared into a chat — and none of those should
    /// have to load ten rows to draw a thumbnail.
    /// </para>
    /// </summary>
    public string ImageUrl { get; set; } = string.Empty;

    public string? Location { get; set; }

    /// <summary>
    /// A video post, shown full-screen in the vertical Reels feed as well as in the ordinary one.
    /// <para>
    /// Set automatically when a post is a single video, because that is the rule the real app follows: you
    /// do not choose to make a reel, you post a video and it is one.
    /// </para>
    /// </summary>
    public bool IsReel { get; set; }

    public int LikeCount { get; set; }
    public int CommentCount { get; set; }

    /// <summary>
    /// Plays. Counted once per viewer per post rather than once per play, so re-watching a reel four times
    /// does not make it look four times more popular than it is.
    /// </summary>
    public int ViewCount { get; set; }

    /// <summary>
    /// The author turned commenting off on this one post. Distinct from the account-wide
    /// <see cref="User.CommentsFrom"/> audience: that says who may ever comment on you, this says that
    /// this particular photo is closed to everyone.
    /// </summary>
    public bool CommentsDisabled { get; set; }

    /// <summary>
    /// The author hid the counts on this one post. The likes still happen and the author can still see
    /// them — it is the number under the photo that goes, not the engagement.
    /// </summary>
    public bool HideCounts { get; set; }

    /// <summary>
    /// Pinned to the top of the author's grid. Instagram allows three; the service enforces that, because
    /// a limit that only the client knows about is not a limit.
    /// </summary>
    public bool IsPinned { get; set; }

    /// <summary>
    /// Moved to the archive: off the grid, out of every feed, still owned by the author and restorable.
    /// A softer thing than a delete, and the reason a delete stays permanent.
    /// </summary>
    public bool IsArchived { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>The carousel, in the author's order. One item for an ordinary single photo.</summary>
    public ICollection<PostMedia> Media { get; set; } = new List<PostMedia>();

    public ICollection<PostLike> Likes { get; set; } = new List<PostLike>();
    public ICollection<Comment> Comments { get; set; } = new List<Comment>();
    public ICollection<PostHashtag> Hashtags { get; set; } = new List<PostHashtag>();

    /// <summary>The accounts named in the photo itself, as opposed to @-mentioned in the caption.</summary>
    public ICollection<PostTag> Tags { get; set; } = new List<PostTag>();
}

/// <summary>
/// Somebody tagged in a photo, and where on it their label sits.
/// <para>
/// It is not the same relation as an @mention in a caption. A mention is a piece of text that happens to
/// resolve to an account; a tag is an edge from the post to the account, which is why it can be listed on
/// their profile under "Tagged", removed by them without touching the caption, and counted.
/// </para>
/// </summary>
public class PostTag
{
    public int Id { get; set; }

    public int PostId { get; set; }
    public Post Post { get; set; } = null!;

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    /// <summary>Which item of the carousel the label is pinned to.</summary>
    public int MediaPosition { get; set; }

    /// <summary>Where the label sits on that photo, 0–1 across and down, so it survives any render size.</summary>
    public double X { get; set; } = 0.5;

    public double Y { get; set; } = 0.5;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// One person having watched one reel.
/// <para>
/// A row per viewer rather than a counter bumped on every play, so that re-watching a clip four times
/// does not make it look four times more popular than it is. It is the same shape as
/// <see cref="StoryView"/> and for the same reason — the honest question is how many people saw it, not
/// how many times it started.
/// </para>
/// </summary>
public class PostView
{
    public int Id { get; set; }

    public int PostId { get; set; }
    public Post Post { get; set; } = null!;

    public int ViewerId { get; set; }
    public User Viewer { get; set; } = null!;

    public DateTime ViewedAt { get; set; } = DateTime.UtcNow;
}
