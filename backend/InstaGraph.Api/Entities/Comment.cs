namespace InstaGraph.Api.Entities;

public class Comment
{
    public int Id { get; set; }

    public int PostId { get; set; }
    public Post Post { get; set; } = null!;

    public int AuthorId { get; set; }
    public User Author { get; set; } = null!;

    public string Text { get; set; } = string.Empty;

    /// <summary>
    /// The comment this one answers, or null for a top-level comment. One level only — a reply to a
    /// reply attaches to the same parent, which is what Instagram does and what keeps the thread
    /// readable on a phone.
    /// </summary>
    public int? ParentId { get; set; }

    public Comment? Parent { get; set; }

    public int LikeCount { get; set; }

    /// <summary>Denormalised so a collapsed thread can say "3 replies" without counting rows.</summary>
    public int ReplyCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Comment> Replies { get; set; } = new List<Comment>();
}
