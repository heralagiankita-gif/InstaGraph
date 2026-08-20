using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Graph;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Services;

public interface IRelationshipReader
{
    /// <summary>
    /// Works out how the viewer stands with every account in <paramref name="userIds"/> at once.
    /// </summary>
    Task<RelationshipMap> ForAsync(
        int viewerId, IReadOnlyCollection<int> userIds, CancellationToken ct = default);
}

/// <summary>
/// Answers "how do I stand with this account" for a whole page of people in one go.
/// <para>
/// Three of the four states are in the graph snapshot already — an accepted edge each way, and both.
/// The fourth, a pending request, deliberately is not: a request is not an edge, so the graph must not
/// know about it. That leaves exactly two small queries per page, asked once for every account on it
/// rather than once per row.
/// </para>
/// </summary>
public class RelationshipReader(AppDbContext db, IGraphSnapshotProvider graphProvider) : IRelationshipReader
{
    public async Task<RelationshipMap> ForAsync(
        int viewerId, IReadOnlyCollection<int> userIds, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);

        if (userIds.Count == 0)
        {
            return new RelationshipMap(graph, viewerId, [], []);
        }

        var ids = userIds.ToList();

        // Requests the viewer has sent that are still waiting.
        var sent = await db.Follows
            .AsNoTracking()
            .Where(f => f.FollowerId == viewerId && f.IsPending && ids.Contains(f.FolloweeId))
            .Select(f => f.FolloweeId)
            .ToListAsync(ct);

        // Requests waiting on the viewer's own account.
        var received = await db.Follows
            .AsNoTracking()
            .Where(f => f.FolloweeId == viewerId && f.IsPending && ids.Contains(f.FollowerId))
            .Select(f => f.FollowerId)
            .ToListAsync(ct);

        return new RelationshipMap(graph, viewerId, sent.ToHashSet(), received.ToHashSet());
    }
}

/// <summary>The answer for one page of people, ready to stamp onto any DTO that carries a follow button.</summary>
public sealed class RelationshipMap(
    SocialGraph graph,
    int viewerId,
    HashSet<int> requestsSent,
    HashSet<int> requestsReceived)
{
    public bool IsFollowing(int userId) => graph.IsFollowing(viewerId, userId);

    public bool FollowsYou(int userId) => graph.IsFollowing(userId, viewerId);

    /// <summary>Both edges exist. Not a stored fact — the intersection of the two directions.</summary>
    public bool IsFriend(int userId) => IsFollowing(userId) && FollowsYou(userId);

    public bool FollowRequested(int userId) => requestsSent.Contains(userId);

    public bool RequestedYou(int userId) => requestsReceived.Contains(userId);

    /// <summary>The summary shape plus every flag a follow button needs.</summary>
    public UserRelation Describe(User user) => new()
    {
        Id = user.Id,
        Username = user.Username,
        FullName = user.FullName,
        AvatarUrl = user.AvatarUrl,
        IsPrivate = user.IsPrivate,
        IsVerified = user.IsVerified,
        IsMe = user.Id == viewerId,
        IsFollowing = IsFollowing(user.Id),
        FollowRequested = FollowRequested(user.Id),
        FollowsYou = FollowsYou(user.Id),
        RequestedYou = RequestedYou(user.Id),
        IsFriend = IsFriend(user.Id)
    };
}
