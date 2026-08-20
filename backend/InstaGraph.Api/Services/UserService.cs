using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Graph;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Services;

public interface IUserService
{
    Task<ProfileResponse> GetProfileAsync(int viewerId, string username, CancellationToken ct = default);
    Task<ProfileResponse> UpdateProfileAsync(int userId, UpdateProfileRequest request, CancellationToken ct = default);
    Task<UserSummary> UpdateAvatarAsync(int userId, IFormFile file, CancellationToken ct = default);

    Task<FollowResponse> FollowAsync(int viewerId, string username, CancellationToken ct = default);
    Task<FollowResponse> UnfollowAsync(int viewerId, string username, CancellationToken ct = default);
    Task<FollowResponse> RemoveFollowerAsync(int viewerId, string username, CancellationToken ct = default);

    Task<Page<UserRelation>> FollowersAsync(int viewerId, string username, int page, int pageSize, CancellationToken ct = default);
    Task<Page<UserRelation>> FollowingAsync(int viewerId, string username, int page, int pageSize, CancellationToken ct = default);
    Task<Page<UserRelation>> FriendsAsync(int viewerId, string username, int page, int pageSize, CancellationToken ct = default);

    Task<SearchResponse> SearchAsync(int viewerId, string term, int limit, CancellationToken ct = default);

    Task<IReadOnlyList<UserSummary>> FollowRequestsAsync(int userId, CancellationToken ct = default);
    Task RespondToFollowRequestAsync(int userId, string username, bool accept, CancellationToken ct = default);

    Task<RelationshipResponse> BlockAsync(int viewerId, string username, CancellationToken ct = default);
    Task<RelationshipResponse> UnblockAsync(int viewerId, string username, CancellationToken ct = default);
    Task<IReadOnlyList<UserSummary>> BlockedAsync(int viewerId, CancellationToken ct = default);
    Task<IReadOnlyList<UserSummary>> MutedAsync(int viewerId, CancellationToken ct = default);

    Task<RelationshipResponse> MuteAsync(int viewerId, string username, bool muted, CancellationToken ct = default);
}

public class UserService(
    AppDbContext db,
    IGraphSnapshotProvider graphProvider,
    IRelationshipReader relationships,
    INotificationService notifications,
    IImageStorage storage) : IUserService
{
    // ------------------------------------------------------------------ profile

    public async Task<ProfileResponse> GetProfileAsync(int viewerId, string username, CancellationToken ct = default)
    {
        var user = await FindAsync(username, ct);
        var graph = await graphProvider.GetAsync(ct);

        var isMe = user.Id == viewerId;

        // If they blocked you, the profile does not load at all. The message is the same one an unknown
        // handle gets, so a block cannot be told apart from an account that was never there.
        if (!isMe && await db.Blocks.AnyAsync(b => b.BlockerId == user.Id && b.BlockedId == viewerId, ct))
        {
            throw AppException.NotFound("That account does not exist.");
        }

        var isBlocked = !isMe && await db.Blocks
            .AnyAsync(b => b.BlockerId == viewerId && b.BlockedId == user.Id, ct);

        var isMuted = !isMe && await db.Mutes
            .AnyAsync(m => m.MuterId == viewerId && m.MutedId == user.Id, ct);

        var isFollowing = graph.IsFollowing(viewerId, user.Id);
        var followsYou = graph.IsFollowing(user.Id, viewerId);

        var requested = !isMe && !isFollowing && await db.Follows
            .AnyAsync(f => f.FollowerId == viewerId && f.FolloweeId == user.Id && f.IsPending, ct);

        // Their request waiting on your own private account — the mirror of the line above, and the
        // reason a profile can offer "Confirm" instead of only "Follow".
        var requestedYou = !isMe && !followsYou && await db.Follows
            .AnyAsync(f => f.FollowerId == user.Id && f.FolloweeId == viewerId && f.IsPending, ct);

        // The people you follow who also follow them. One walk of two sorted lists — the same operation
        // behind Instagram's "Followed by … and 12 others".
        List<int> mutualIds = isMe ? [] : graph.MutualConnections(viewerId, user.Id);
        var previewIds = mutualIds.Take(3).ToList();

        List<UserSummary> preview = [];

        if (previewIds.Count > 0)
        {
            preview = await db.Users
                .AsNoTracking()
                .Where(u => previewIds.Contains(u.Id))
                .Select(u => new UserSummary
                {
                    Id = u.Id,
                    Username = u.Username,
                    FullName = u.FullName,
                    AvatarUrl = u.AvatarUrl,
                    IsPrivate = u.IsPrivate,
                    IsVerified = u.IsVerified
                })
                .ToListAsync(ct);
        }

        return new ProfileResponse
        {
            Id = user.Id,
            Username = user.Username,
            FullName = user.FullName,
            AvatarUrl = user.AvatarUrl,
            IsPrivate = user.IsPrivate,
            IsVerified = user.IsVerified,
            Bio = user.Bio,
            PostCount = user.PostCount,
            FollowerCount = user.FollowerCount,
            FollowingCount = user.FollowingCount,
            IsMe = isMe,
            IsFollowing = isFollowing,
            FollowRequested = requested,
            FollowsYou = followsYou,
            RequestedYou = requestedYou,

            // Not stored anywhere: both directions of the edge existing at once is what makes a friend.
            IsFriend = isFollowing && followsYou,
            FriendCount = graph.FriendCount(user.Id),
            // A blocked account is locked as well: nothing of theirs should be reachable while the wall
            // is up, private or not.
            IsLocked = (user.IsPrivate && !isMe && !isFollowing) || isBlocked,
            IsBlocked = isBlocked,
            IsMuted = isMuted,
            MutualFollowers = preview,
            MutualFollowerCount = mutualIds.Count
        };
    }

    public async Task<ProfileResponse> UpdateProfileAsync(
        int userId, UpdateProfileRequest request, CancellationToken ct = default)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw AppException.NotFound();

        user.FullName = request.FullName.Trim();
        user.Bio = request.Bio.Trim();

        // Going public accepts everyone who was waiting; leaving them pending would be a queue nobody
        // could ever clear.
        if (user.IsPrivate && !request.IsPrivate)
        {
            var pending = await db.Follows.Where(f => f.FolloweeId == userId && f.IsPending).ToListAsync(ct);

            foreach (var follow in pending)
            {
                follow.IsPending = false;
                user.FollowerCount++;

                var follower = await db.Users.FirstAsync(u => u.Id == follow.FollowerId, ct);
                follower.FollowingCount++;
            }

            if (pending.Count > 0)
            {
                graphProvider.Invalidate();
            }
        }

        user.IsPrivate = request.IsPrivate;

        await db.SaveChangesAsync(ct);

        return await GetProfileAsync(userId, user.Username, ct);
    }

    public async Task<UserSummary> UpdateAvatarAsync(int userId, IFormFile file, CancellationToken ct = default)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw AppException.NotFound();

        var previous = user.AvatarUrl;
        user.AvatarUrl = await storage.SaveAsync(file, ct);

        await db.SaveChangesAsync(ct);

        // Only once the row is safely updated, so a failed save cannot leave the account pointing at a
        // file that no longer exists.
        storage.Delete(previous);

        return user.ToSummary();
    }

    // ------------------------------------------------------------------- follow

    public async Task<FollowResponse> FollowAsync(int viewerId, string username, CancellationToken ct = default)
    {
        var target = await FindAsync(username, ct);

        if (target.Id == viewerId)
        {
            throw AppException.BadRequest("You cannot follow yourself.");
        }

        // Either direction of block stops the edge being created. The message does not say which, so it
        // cannot be used to work out that somebody blocked you.
        var walled = await db.Blocks.AnyAsync(
            b => (b.BlockerId == viewerId && b.BlockedId == target.Id)
                 || (b.BlockerId == target.Id && b.BlockedId == viewerId), ct);

        if (walled)
        {
            throw AppException.Forbidden("You cannot follow this account.");
        }

        var existing = await db.Follows
            .FirstOrDefaultAsync(f => f.FollowerId == viewerId && f.FolloweeId == target.Id, ct);

        if (existing is not null)
        {
            throw AppException.Conflict(existing.IsPending
                ? "You have already requested to follow this account."
                : "You already follow this account.");
        }

        var viewer = await db.Users.FirstAsync(u => u.Id == viewerId, ct);

        // A private account gets a request instead of an edge. Until it is accepted the edge does not
        // exist, so nothing about that account reaches the feed.
        var pending = target.IsPrivate;

        db.Follows.Add(new Follow
        {
            FollowerId = viewerId,
            FolloweeId = target.Id,
            IsPending = pending
        });

        if (!pending)
        {
            // Degrees move inside the same transaction as the edge, so they cannot drift.
            target.FollowerCount++;
            viewer.FollowingCount++;
        }

        notifications.Add(target.Id, viewerId, pending ? NotificationKind.FollowRequest : NotificationKind.Follow);

        await db.SaveChangesAsync(ct);
        await notifications.PushPendingAsync(ct);
        graphProvider.Invalidate();

        return new FollowResponse
        {
            IsFollowing = !pending,
            FollowRequested = pending,
            FollowerCount = target.FollowerCount
        };
    }

    public async Task<FollowResponse> UnfollowAsync(int viewerId, string username, CancellationToken ct = default)
    {
        var target = await FindAsync(username, ct);

        var follow = await db.Follows
            .FirstOrDefaultAsync(f => f.FollowerId == viewerId && f.FolloweeId == target.Id, ct)
            ?? throw AppException.NotFound("You do not follow this account.");

        var viewer = await db.Users.FirstAsync(u => u.Id == viewerId, ct);

        if (!follow.IsPending)
        {
            target.FollowerCount = Math.Max(0, target.FollowerCount - 1);
            viewer.FollowingCount = Math.Max(0, viewer.FollowingCount - 1);
        }

        db.Follows.Remove(follow);

        await notifications.RemoveAsync(target.Id, viewerId, NotificationKind.Follow, null, ct);
        await notifications.RemoveAsync(target.Id, viewerId, NotificationKind.FollowRequest, null, ct);

        await db.SaveChangesAsync(ct);
        graphProvider.Invalidate();

        return new FollowResponse { IsFollowing = false, FollowRequested = false, FollowerCount = target.FollowerCount };
    }

    /// <summary>Removes somebody who follows you — the reverse edge, deleted from the other end.</summary>
    public async Task<FollowResponse> RemoveFollowerAsync(int viewerId, string username, CancellationToken ct = default)
    {
        var other = await FindAsync(username, ct);

        var follow = await db.Follows
            .FirstOrDefaultAsync(f => f.FollowerId == other.Id && f.FolloweeId == viewerId, ct)
            ?? throw AppException.NotFound("That account does not follow you.");

        var viewer = await db.Users.FirstAsync(u => u.Id == viewerId, ct);

        if (!follow.IsPending)
        {
            viewer.FollowerCount = Math.Max(0, viewer.FollowerCount - 1);
            other.FollowingCount = Math.Max(0, other.FollowingCount - 1);
        }

        db.Follows.Remove(follow);
        await db.SaveChangesAsync(ct);
        graphProvider.Invalidate();

        return new FollowResponse { IsFollowing = false, FollowRequested = false, FollowerCount = viewer.FollowerCount };
    }

    public async Task<IReadOnlyList<UserSummary>> FollowRequestsAsync(int userId, CancellationToken ct = default)
    {
        return await db.Follows
            .AsNoTracking()
            .Where(f => f.FolloweeId == userId && f.IsPending)
            .OrderByDescending(f => f.CreatedAt)
            .Select(f => new UserSummary
            {
                Id = f.Follower.Id,
                Username = f.Follower.Username,
                FullName = f.Follower.FullName,
                AvatarUrl = f.Follower.AvatarUrl,
                IsPrivate = f.Follower.IsPrivate,
                IsVerified = f.Follower.IsVerified
            })
            .ToListAsync(ct);
    }

    public async Task RespondToFollowRequestAsync(
        int userId, string username, bool accept, CancellationToken ct = default)
    {
        var requester = await FindAsync(username, ct);

        var follow = await db.Follows
            .FirstOrDefaultAsync(f => f.FollowerId == requester.Id && f.FolloweeId == userId && f.IsPending, ct)
            ?? throw AppException.NotFound("There is no request from that account.");

        if (accept)
        {
            follow.IsPending = false;

            var me = await db.Users.FirstAsync(u => u.Id == userId, ct);
            me.FollowerCount++;
            requester.FollowingCount++;

            notifications.Add(requester.Id, userId, NotificationKind.Follow);
        }
        else
        {
            db.Follows.Remove(follow);
        }

        await notifications.RemoveAsync(userId, requester.Id, NotificationKind.FollowRequest, null, ct);

        await db.SaveChangesAsync(ct);
        await notifications.PushPendingAsync(ct);
        graphProvider.Invalidate();
    }

    // -------------------------------------------------------------------- lists

    public async Task<Page<UserRelation>> FollowersAsync(
        int viewerId, string username, int page, int pageSize, CancellationToken ct = default)
    {
        var user = await FindAsync(username, ct);
        await GuardVisibilityAsync(viewerId, user, ct);

        var walled = (await graphProvider.GetAsync(ct)).WalledFor(viewerId).ToList();

        var query = db.Follows
            .AsNoTracking()
            .Where(f => f.FolloweeId == user.Id && !f.IsPending && !walled.Contains(f.FollowerId))
            .OrderByDescending(f => f.CreatedAt)
            .Select(f => f.Follower);

        return await PageOfUsersAsync(viewerId, query, page, pageSize, ct);
    }

    public async Task<Page<UserRelation>> FollowingAsync(
        int viewerId, string username, int page, int pageSize, CancellationToken ct = default)
    {
        var user = await FindAsync(username, ct);
        await GuardVisibilityAsync(viewerId, user, ct);

        var walled = (await graphProvider.GetAsync(ct)).WalledFor(viewerId).ToList();

        var query = db.Follows
            .AsNoTracking()
            .Where(f => f.FollowerId == user.Id && !f.IsPending && !walled.Contains(f.FolloweeId))
            .OrderByDescending(f => f.CreatedAt)
            .Select(f => f.Followee);

        return await PageOfUsersAsync(viewerId, query, page, pageSize, ct);
    }

    /// <summary>
    /// Every account this one follows that follows it back. The list Instagram would call friends, and the
    /// only symmetric relationship a directed edge set has.
    /// </summary>
    public async Task<Page<UserRelation>> FriendsAsync(
        int viewerId, string username, int page, int pageSize, CancellationToken ct = default)
    {
        var user = await FindAsync(username, ct);
        await GuardVisibilityAsync(viewerId, user, ct);

        var graph = await graphProvider.GetAsync(ct);

        // Computed in memory from two sorted adjacency lists; only the page being read touches the
        // database. Doing this in SQL would be a self-join of Follows against itself.
        var friendIds = graph.Friends(user.Id)
            .Where(id => !graph.IsWalled(viewerId, id))
            .OrderByDescending(id => graph.EdgeWeight(user.Id, id))
            .ThenByDescending(graph.Influence)
            .ToList();

        var window = friendIds.Skip((page - 1) * pageSize).Take(pageSize + 1).ToList();
        var hasMore = window.Count > pageSize;
        var ids = window.Take(pageSize).ToList();

        var users = await db.Users
            .AsNoTracking()
            .Where(u => ids.Contains(u.Id) && u.IsActive)
            .ToDictionaryAsync(u => u.Id, ct);

        var map = await relationships.ForAsync(viewerId, ids, ct);

        return new Page<UserRelation>
        {
            // Ordered by the graph, so the ranking survives the round trip.
            Items = ids.Where(users.ContainsKey).Select(id => map.Describe(users[id])).ToList(),
            PageNumber = page,
            PageSize = pageSize,
            HasMore = hasMore
        };
    }

    private async Task<Page<UserRelation>> PageOfUsersAsync(
        int viewerId, IQueryable<User> query, int page, int pageSize, CancellationToken ct)
    {
        // One extra row is fetched purely to answer "is there another page?" without a second COUNT.
        var rows = await query
            .Where(u => u.IsActive)
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .ToListAsync(ct);

        var window = rows.Take(pageSize).ToList();

        // Two small queries for the whole page rather than a relationship lookup per row.
        var map = await relationships.ForAsync(viewerId, window.Select(u => u.Id).ToList(), ct);

        return new Page<UserRelation>
        {
            Items = window.Select(map.Describe).ToList(),
            PageNumber = page,
            PageSize = pageSize,
            HasMore = rows.Count > pageSize
        };
    }

    // ------------------------------------------------------------------- search

    public async Task<SearchResponse> SearchAsync(
        int viewerId, string term, int limit, CancellationToken ct = default)
    {
        term = term.Trim().TrimStart('#').ToLowerInvariant();

        if (term.Length == 0)
        {
            return new SearchResponse();
        }

        var graph = await graphProvider.GetAsync(ct);
        var walled = graph.WalledFor(viewerId).ToList();

        var users = await db.Users
            .AsNoTracking()
            .Where(u => u.IsActive && !walled.Contains(u.Id))
            .Where(u => u.Username.Contains(term) || u.FullName.Contains(term))
            // A prefix match is what the person almost certainly meant, so it sorts above a mid-word one.
            .OrderByDescending(u => u.Username.StartsWith(term))
            .ThenByDescending(u => u.FollowerCount)
            .Take(limit)
            .Select(u => new UserSummary
            {
                Id = u.Id,
                Username = u.Username,
                FullName = u.FullName,
                AvatarUrl = u.AvatarUrl,
                IsPrivate = u.IsPrivate,
                IsVerified = u.IsVerified
            })
            .ToListAsync(ct);

        var tags = await db.Hashtags
            .AsNoTracking()
            .Where(h => h.Tag.Contains(term) && h.PostCount > 0)
            .OrderByDescending(h => h.PostCount)
            .Take(limit)
            .Select(h => new HashtagResponse { Tag = h.Tag, PostCount = h.PostCount })
            .ToListAsync(ct);

        return new SearchResponse { Users = users, Hashtags = tags };
    }

    // ------------------------------------------------------- block and mute

    /// <summary>
    /// Blocking does two separate things: it deletes whatever edges exist between the pair in both
    /// directions, and it records a wall that every later traversal has to respect. Deleting the edges
    /// alone would not hold — a two-hop suggestion would simply find a route around through somebody
    /// they both follow.
    /// </summary>
    public async Task<RelationshipResponse> BlockAsync(
        int viewerId, string username, CancellationToken ct = default)
    {
        var target = await FindAsync(username, ct);

        if (target.Id == viewerId)
        {
            throw AppException.BadRequest("You cannot block yourself.");
        }

        var already = await db.Blocks
            .AnyAsync(b => b.BlockerId == viewerId && b.BlockedId == target.Id, ct);

        if (already)
        {
            return new RelationshipResponse { IsBlocked = true };
        }

        var viewer = await db.Users.FirstAsync(u => u.Id == viewerId, ct);

        // Both directions, and pending requests too — a request left behind would sit in their activity
        // list from somebody they can no longer see.
        var edges = await db.Follows
            .Where(f => (f.FollowerId == viewerId && f.FolloweeId == target.Id)
                        || (f.FollowerId == target.Id && f.FolloweeId == viewerId))
            .ToListAsync(ct);

        foreach (var edge in edges)
        {
            if (!edge.IsPending)
            {
                if (edge.FollowerId == viewerId)
                {
                    viewer.FollowingCount = Math.Max(0, viewer.FollowingCount - 1);
                    target.FollowerCount = Math.Max(0, target.FollowerCount - 1);
                }
                else
                {
                    target.FollowingCount = Math.Max(0, target.FollowingCount - 1);
                    viewer.FollowerCount = Math.Max(0, viewer.FollowerCount - 1);
                }
            }

            db.Follows.Remove(edge);
        }

        // Anything already sent between them goes as well.
        var notifications = await db.Notifications
            .Where(n => (n.RecipientId == viewerId && n.ActorId == target.Id)
                        || (n.RecipientId == target.Id && n.ActorId == viewerId))
            .ToListAsync(ct);

        db.Notifications.RemoveRange(notifications);

        var mutes = await db.Mutes
            .Where(m => m.MuterId == viewerId && m.MutedId == target.Id)
            .ToListAsync(ct);

        db.Mutes.RemoveRange(mutes);

        db.Blocks.Add(new Block { BlockerId = viewerId, BlockedId = target.Id });

        await db.SaveChangesAsync(ct);
        graphProvider.Invalidate();

        return new RelationshipResponse { IsBlocked = true };
    }

    /// <summary>
    /// Unblocking removes the wall. It does not put the edges back — those were deleted, and nobody is
    /// re-followed on their behalf.
    /// </summary>
    public async Task<RelationshipResponse> UnblockAsync(
        int viewerId, string username, CancellationToken ct = default)
    {
        var target = await FindAsync(username, ct);

        var block = await db.Blocks
            .FirstOrDefaultAsync(b => b.BlockerId == viewerId && b.BlockedId == target.Id, ct);

        if (block is not null)
        {
            db.Blocks.Remove(block);
            await db.SaveChangesAsync(ct);
            graphProvider.Invalidate();
        }

        return new RelationshipResponse { IsBlocked = false };
    }

    public async Task<IReadOnlyList<UserSummary>> BlockedAsync(int viewerId, CancellationToken ct = default) =>
        await db.Blocks
            .AsNoTracking()
            .Where(b => b.BlockerId == viewerId)
            .OrderByDescending(b => b.CreatedAt)
            .Select(b => new UserSummary
            {
                Id = b.Blocked.Id,
                Username = b.Blocked.Username,
                FullName = b.Blocked.FullName,
                AvatarUrl = b.Blocked.AvatarUrl,
                IsPrivate = b.Blocked.IsPrivate,
                IsVerified = b.Blocked.IsVerified
            })
            .ToListAsync(ct);

    /// <summary>
    /// Everyone you have muted. Worth being able to list, because muting is invisible from every other
    /// screen by design — the edge is intact and the profile still says Following.
    /// </summary>
    public async Task<IReadOnlyList<UserSummary>> MutedAsync(int viewerId, CancellationToken ct = default) =>
        await db.Mutes
            .AsNoTracking()
            .Where(m => m.MuterId == viewerId)
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => new UserSummary
            {
                Id = m.Muted.Id,
                Username = m.Muted.Username,
                FullName = m.Muted.FullName,
                AvatarUrl = m.Muted.AvatarUrl,
                IsPrivate = m.Muted.IsPrivate,
                IsVerified = m.Muted.IsVerified
            })
            .ToListAsync(ct);

    /// <summary>
    /// Muting leaves the edge alone. They stay in your following count, they are never told, and the only
    /// thing that changes is that the feed stops treating their posts as candidates.
    /// </summary>
    public async Task<RelationshipResponse> MuteAsync(
        int viewerId, string username, bool muted, CancellationToken ct = default)
    {
        var target = await FindAsync(username, ct);

        if (target.Id == viewerId)
        {
            throw AppException.BadRequest("You cannot mute yourself.");
        }

        var existing = await db.Mutes
            .FirstOrDefaultAsync(m => m.MuterId == viewerId && m.MutedId == target.Id, ct);

        if (muted && existing is null)
        {
            db.Mutes.Add(new Mute { MuterId = viewerId, MutedId = target.Id });
        }
        else if (!muted && existing is not null)
        {
            db.Mutes.Remove(existing);
        }

        await db.SaveChangesAsync(ct);

        return new RelationshipResponse { IsMuted = muted };
    }

    // ------------------------------------------------------------------ helpers

    private async Task<User> FindAsync(string username, CancellationToken ct)
    {
        username = username.Trim().ToLowerInvariant();

        return await db.Users.FirstOrDefaultAsync(u => u.Username == username && u.IsActive, ct)
               ?? throw AppException.NotFound("That account does not exist.");
    }

    /// <summary>
    /// A private account's lists are only visible to itself and to the people it accepted. A block closes
    /// them regardless of privacy, in both directions.
    /// </summary>
    private async Task GuardVisibilityAsync(int viewerId, User target, CancellationToken ct)
    {
        if (target.Id == viewerId)
        {
            return;
        }

        var graph = await graphProvider.GetAsync(ct);

        if (graph.IsWalled(viewerId, target.Id))
        {
            throw AppException.NotFound("That account does not exist.");
        }

        if (!target.IsPrivate)
        {
            return;
        }

        var allowed = await db.Follows
            .AnyAsync(f => f.FollowerId == viewerId && f.FolloweeId == target.Id && !f.IsPending, ct);

        if (!allowed)
        {
            throw AppException.Forbidden("This account is private.");
        }
    }
}
