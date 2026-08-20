namespace InstaGraph.Api.Entities;

/// <summary>
/// A note: a line of text that sits above the inbox for a day and then disappears.
/// <para>
/// The interesting part is who it reaches. A post travels along your in-edges — everyone who follows you
/// sees it. A note travels along the edges that run <em>both</em> ways, so it reaches only the accounts
/// you and they each chose, and it can be narrowed further to the close-friends subset. Three different
/// audiences off one edge set: followers, mutuals, and a hand-picked list.
/// </para>
/// </summary>
public class Note
{
    public int Id { get; set; }

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    public string Text { get; set; } = string.Empty;

    /// <summary>Narrows the audience from "accounts we both follow" to the close-friends list.</summary>
    public bool CloseFriendsOnly { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Twenty-four hours after it was written. Expired notes are never read and are swept lazily.</summary>
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddHours(24);
}

/// <summary>
/// A label on an edge you already have, and nothing more.
/// <para>
/// Close friends is a subset of the people who follow you — the audience for a note marked private.
/// Favourites is a subset of the people you follow — accounts whose posts you want lifted in the feed.
/// Neither creates or destroys an edge, which is why both are stored as their own rows rather than as a
/// column on <see cref="Follow"/>: the same pair can be in either, both, or neither, and one direction
/// says nothing about the other.
/// </para>
/// </summary>
public class UserListEntry
{
    public int Id { get; set; }

    /// <summary>Whose list this is.</summary>
    public int OwnerId { get; set; }

    public User Owner { get; set; } = null!;

    /// <summary>Who is on it.</summary>
    public int UserId { get; set; }

    public User User { get; set; } = null!;

    public UserListKind Kind { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum UserListKind
{
    /// <summary>A subset of your followers. Sees your private notes.</summary>
    CloseFriends = 0,

    /// <summary>A subset of the accounts you follow. Their posts are lifted in your feed.</summary>
    Favorites = 1
}
