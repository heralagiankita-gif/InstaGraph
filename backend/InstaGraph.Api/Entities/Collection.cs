namespace InstaGraph.Api.Entities;

/// <summary>
/// A folder inside your saved posts.
/// <para>
/// Saving is already private; a collection only sorts what is there. The pointer stays on
/// <see cref="SavedPost"/> rather than the post moving into the folder, so a post can be saved without
/// being filed, and deleting a collection puts its posts back into the unsorted list instead of
/// unsaving them.
/// </para>
/// </summary>
public class Collection
{
    public int Id { get; set; }

    public int OwnerId { get; set; }
    public User Owner { get; set; } = null!;

    public string Name { get; set; } = string.Empty;

    /// <summary>The newest saved post filed here, kept so the cover does not need a second query.</summary>
    public string? CoverUrl { get; set; }

    public int ItemCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
