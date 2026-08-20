namespace InstaGraph.Api.Entities;

/// <summary>
/// A named group of stories kept on a profile after the day they were posted.
/// <para>
/// A story is defined by expiring, so a highlight is not "a story that lasts longer" — it is a second
/// reference to one. The story row keeps its own expiry and drops out of the tray on time; the highlight
/// holds a pointer to it that expiry does not touch. That is why removing a story from a highlight puts it
/// back to being expired rather than deleting it, and why adding one does not resurrect it in anybody's
/// tray.
/// </para>
/// </summary>
public class Highlight
{
    public int Id { get; set; }

    public int OwnerId { get; set; }
    public User Owner { get; set; } = null!;

    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// The circle drawn on the profile. Chosen by the author, or the first story's photo when they did
    /// not choose one.
    /// </summary>
    public string? CoverUrl { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<HighlightStory> Stories { get; set; } = new List<HighlightStory>();
}

/// <summary>One story's place in one highlight. The same story may sit in several.</summary>
public class HighlightStory
{
    public int Id { get; set; }

    public int HighlightId { get; set; }
    public Highlight Highlight { get; set; } = null!;

    public int StoryId { get; set; }
    public Story Story { get; set; } = null!;

    /// <summary>Oldest first, the way a highlight plays.</summary>
    public int Position { get; set; }
}
