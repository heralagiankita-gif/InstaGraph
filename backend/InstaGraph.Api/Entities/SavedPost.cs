namespace InstaGraph.Api.Entities;

/// <summary>
/// A bookmark. Private to the person who made it — unlike a like, nobody else can see it and it does not
/// count towards anything on the post.
/// </summary>
public class SavedPost
{
    public int Id { get; set; }

    public int PostId { get; set; }
    public Post Post { get; set; } = null!;

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    /// <summary>Which folder it was filed into, or null for the unsorted list every save starts in.</summary>
    public int? CollectionId { get; set; }

    public Collection? Collection { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
