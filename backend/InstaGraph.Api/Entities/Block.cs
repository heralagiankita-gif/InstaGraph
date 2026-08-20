namespace InstaGraph.Api.Entities;

/// <summary>
/// A block. Directed — <see cref="BlockerId"/> blocked <see cref="BlockedId"/> — but enforced in both
/// directions, because the person who was blocked must not see the person who blocked them either.
/// <para>
/// In graph terms this does two things: it deletes any edges between the pair, and it adds a permanent
/// filter that every traversal has to respect from then on. Deleting the edges alone would not be
/// enough, since two-hop suggestions would keep finding a route around.
/// </para>
/// </summary>
public class Block
{
    public int Id { get; set; }

    public int BlockerId { get; set; }
    public User Blocker { get; set; } = null!;

    public int BlockedId { get; set; }
    public User Blocked { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A mute. The follow edge stays — they are still in your following count, and they are not told — but
/// their posts stop being candidates for your feed.
/// <para>
/// Worth having as its own concept: it is the case where an edge exists and carries nothing, which is
/// the difference between "who you are connected to" and "what you are shown".
/// </para>
/// </summary>
public class Mute
{
    public int Id { get; set; }

    public int MuterId { get; set; }
    public User Muter { get; set; } = null!;

    public int MutedId { get; set; }
    public User Muted { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
