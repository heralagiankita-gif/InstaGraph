namespace InstaGraph.Api.Entities;

/// <summary>
/// One directed edge: <see cref="FollowerId"/> → <see cref="FolloweeId"/>. The entire social graph is
/// this table; every other feature is a question asked of it.
/// </summary>
public class Follow
{
    public int Id { get; set; }

    public int FollowerId { get; set; }
    public User Follower { get; set; } = null!;

    public int FolloweeId { get; set; }
    public User Followee { get; set; } = null!;

    /// <summary>
    /// How much these two actually interact — likes and comments in either direction. The feed uses it as
    /// edge weight, which is why a close friend outranks somebody you followed once and forgot.
    /// </summary>
    public int InteractionScore { get; set; }

    /// <summary>A follow request to a private account stays pending until the owner accepts it.</summary>
    public bool IsPending { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
