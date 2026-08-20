namespace InstaGraph.Api.Entities;

public enum NotificationKind
{
    Like = 0,
    Comment = 1,
    Follow = 2,
    FollowRequest = 3,

    /// <summary>Somebody wrote @you in a caption or a comment.</summary>
    Mention = 4,

    /// <summary>Somebody answered your comment.</summary>
    Reply = 5,

    /// <summary>Somebody liked your comment.</summary>
    CommentLike = 6,

    /// <summary>Somebody named you in a photo, rather than writing your handle underneath one.</summary>
    Tag = 7
}

public class Notification
{
    public int Id { get; set; }

    /// <summary>Who sees it.</summary>
    public int RecipientId { get; set; }

    public User Recipient { get; set; } = null!;

    /// <summary>Who caused it.</summary>
    public int ActorId { get; set; }

    public User Actor { get; set; } = null!;

    public NotificationKind Kind { get; set; }

    /// <summary>Set for likes and comments so the row can link to the photo.</summary>
    public int? PostId { get; set; }

    public Post? Post { get; set; }

    public bool IsRead { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
