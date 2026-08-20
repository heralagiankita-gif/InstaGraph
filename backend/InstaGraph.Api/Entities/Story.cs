namespace InstaGraph.Api.Entities;

/// <summary>
/// A story: a photo that exists for a day and then stops existing.
/// <para>
/// It is worth having next to a post because it travels along the same edges and answers a different
/// question of them. A post is pulled — it sits on a profile and is ranked into feeds. A story is pushed:
/// it goes to everyone with an edge pointing at you, in a fixed row, in the order they arrived, and then
/// it is gone. Nothing ranks it, so nothing has to justify the order.
/// </para>
/// <para>
/// Together with notes and close friends that gives three audiences off one edge set — followers
/// (in-edges), mutuals (in-edges intersected with out-edges), and a named subset of the first — and none
/// of them is stored as a list of recipients. Each is recomputed from the edges when somebody looks.
/// </para>
/// </summary>
public class Story
{
    public int Id { get; set; }

    public int AuthorId { get; set; }
    public User Author { get; set; } = null!;

    /// <summary>Relative path to the uploaded file, the same pipeline a post uses.</summary>
    public string ImageUrl { get; set; } = string.Empty;

    /// <summary>The line of text laid over the photo. Optional.</summary>
    public string Caption { get; set; } = string.Empty;

    /// <summary>Narrows the audience from every follower to the close-friends list.</summary>
    public bool CloseFriendsOnly { get; set; }

    /// <summary>Denormalised so the ring can show a count without walking the view table.</summary>
    public int ViewCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Twenty-four hours after it was posted. Expiry is a filter on read rather than a delete job: a story
    /// that has run out is simply never selected, and the row is swept later.
    /// </summary>
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddHours(24);

    public ICollection<StoryView> Views { get; set; } = new List<StoryView>();
}

/// <summary>
/// One person having seen one story.
/// <para>
/// Unlike a like this is not public to everyone — only the author sees the list — and unlike a save it is
/// not private to the viewer either. It is the one piece of engagement in the app that is visible to
/// exactly one person, which is why it gets its own table rather than reusing either.
/// </para>
/// </summary>
public class StoryView
{
    public int Id { get; set; }

    public int StoryId { get; set; }
    public Story Story { get; set; } = null!;

    public int ViewerId { get; set; }
    public User Viewer { get; set; } = null!;

    public DateTime ViewedAt { get; set; } = DateTime.UtcNow;
}
