namespace InstaGraph.Api.Entities;

/// <summary>What a single item on a post actually is. The player is chosen from this, not from the file name.</summary>
public enum MediaKind
{
    Image = 0,
    Video = 1
}

/// <summary>
/// One photo or video on a post, and its place in the run.
/// <para>
/// A post used to be a row with one <c>ImageUrl</c> on it. Making the media a table instead is what turns
/// a post into a carousel: the caption, the likes and the comment thread stay on the post — there is still
/// exactly one of each, however many photos you swipe through — while the thing you look at becomes a list
/// that can hold ten of them, in an order the author chose.
/// </para>
/// <para>
/// <see cref="Post.ImageUrl"/> is kept as the cover so that everything which only ever wanted one picture —
/// the profile grid, a notification row, a post shared into a chat — carries on reading a single column
/// and never has to load the run to draw a thumbnail.
/// </para>
/// </summary>
public class PostMedia
{
    public int Id { get; set; }

    public int PostId { get; set; }
    public Post Post { get; set; } = null!;

    public MediaKind Kind { get; set; } = MediaKind.Image;

    /// <summary>Relative path to the uploaded file, e.g. <c>/uploads/9f3c.jpg</c>.</summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>
    /// The still frame to draw before a video plays, grabbed from the first frame by the browser that
    /// uploaded it. Null on an image, and null on a video whose poster could not be captured — in which
    /// case the player shows the first frame itself once it has loaded enough to have one.
    /// </summary>
    public string? PosterUrl { get; set; }

    /// <summary>Zero-based place in the carousel. Unique per post, so the order is never ambiguous.</summary>
    public int Position { get; set; }

    /// <summary>
    /// Width ÷ height, as measured by the browser before upload.
    /// <para>
    /// Worth storing because the alternative is a feed that jumps: without it every card is laid out at a
    /// guessed height and then shoved down the moment the real image arrives. With it the space is
    /// correct before the first byte of the photo does.
    /// </para>
    /// </summary>
    public double AspectRatio { get; set; } = 1.0;

    /// <summary>Length of a video in milliseconds; zero on an image.</summary>
    public int DurationMs { get; set; }
}
