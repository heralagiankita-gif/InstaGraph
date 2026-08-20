using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Graph;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Services;

public interface ISettingsService
{
    Task<SettingsResponse> GetAsync(int userId, CancellationToken ct = default);

    Task<SettingsResponse> UpdateAsync(int userId, UpdateSettingsRequest request, CancellationToken ct = default);

    /// <summary>
    /// The candidates for one of the lists, each marked with whether they are already on it. Close friends
    /// is drawn from your followers and favourites from the accounts you follow — the two lists live on
    /// opposite directions of the same edge.
    /// </summary>
    Task<Page<ListMember>> ListAsync(
        int userId, UserListKind kind, int page, int pageSize, CancellationToken ct = default);

    Task<int> SetListEntryAsync(
        int userId, UserListKind kind, string username, bool on, CancellationToken ct = default);

    Task<ActivitySummary> ActivityAsync(int userId, CancellationToken ct = default);
}

public class SettingsService(
    AppDbContext db,
    IGraphSnapshotProvider graphProvider,
    IRelationshipReader relationships) : ISettingsService
{
    public async Task<SettingsResponse> GetAsync(int userId, CancellationToken ct = default)
    {
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct)
                   ?? throw AppException.NotFound();

        return await DescribeAsync(user, ct);
    }

    public async Task<SettingsResponse> UpdateAsync(
        int userId, UpdateSettingsRequest request, CancellationToken ct = default)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct)
                   ?? throw AppException.NotFound();

        // Going public accepts everyone already waiting — the same rule the profile editor applies, kept
        // here so it holds whichever screen made the change.
        if (user.IsPrivate && !request.IsPrivate)
        {
            var pending = await db.Follows.Where(f => f.FolloweeId == userId && f.IsPending).ToListAsync(ct);

            foreach (var follow in pending)
            {
                follow.IsPending = false;
                user.FollowerCount++;

                var follower = await db.Users.FirstOrDefaultAsync(u => u.Id == follow.FollowerId, ct);

                if (follower is not null)
                {
                    follower.FollowingCount++;
                }
            }

            if (pending.Count > 0)
            {
                graphProvider.Invalidate();
            }
        }

        user.IsPrivate = request.IsPrivate;
        user.MessagesFrom = ParseAudience(request.MessagesFrom);
        user.CommentsFrom = ParseAudience(request.CommentsFrom);
        user.ShowActivityStatus = request.ShowActivityStatus;
        user.ShowReadReceipts = request.ShowReadReceipts;
        user.HideLikeCounts = request.HideLikeCounts;
        user.HiddenWords = (request.HiddenWords ?? string.Empty).Trim();

        await db.SaveChangesAsync(ct);

        return await DescribeAsync(user, ct);
    }

    public async Task<Page<ListMember>> ListAsync(
        int userId, UserListKind kind, int page, int pageSize, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);
        var wall = graph.WalledFor(userId);

        // Close friends can only contain people who follow you — there is no point in a private note for
        // somebody who would never see it. Favourites can only contain accounts you follow, because the
        // whole effect is on your own feed.
        var pool = (kind == UserListKind.CloseFriends
                ? graph.Followers(userId)
                : graph.Following(userId))
            .Where(id => id != userId && !wall.Contains(id))
            .ToList();

        var on = (await db.UserListEntries
                .AsNoTracking()
                .Where(e => e.OwnerId == userId && e.Kind == kind)
                .Select(e => e.UserId)
                .ToListAsync(ct))
            .ToHashSet();

        var slice = pool
            // Whoever is already on the list sits at the top, so removing somebody does not mean hunting
            // for them.
            .OrderByDescending(on.Contains)
            .ThenByDescending(id => graph.EdgeWeight(userId, id) + graph.EdgeWeight(id, userId))
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .ToList();

        var hasMore = slice.Count > pageSize;
        var ids = slice.Take(pageSize).ToList();

        var users = await db.Users
            .AsNoTracking()
            .Where(u => ids.Contains(u.Id) && u.IsActive)
            .ToListAsync(ct);

        var map = await relationships.ForAsync(userId, ids, ct);

        var ordered = ids
            .Select(id => users.FirstOrDefault(u => u.Id == id))
            .Where(u => u is not null)
            .Select(u => Describe(map.Describe(u!), on.Contains(u!.Id)))
            .ToList();

        return new Page<ListMember>
        {
            Items = ordered, PageNumber = page, PageSize = pageSize, HasMore = hasMore
        };
    }

    public async Task<int> SetListEntryAsync(
        int userId, UserListKind kind, string username, bool on, CancellationToken ct = default)
    {
        var handle = username.Trim().ToLowerInvariant();

        var target = await db.Users.FirstOrDefaultAsync(u => u.Username == handle && u.IsActive, ct)
                     ?? throw AppException.NotFound("That account does not exist.");

        if (target.Id == userId)
        {
            throw AppException.BadRequest("You are already on your own list.");
        }

        var graph = await graphProvider.GetAsync(ct);

        // The edge has to exist first. Neither list creates one, and neither is allowed to stand in for
        // one — a favourite you do not follow would silently put a stranger in your feed.
        var eligible = kind == UserListKind.CloseFriends
            ? graph.IsFollowing(target.Id, userId)
            : graph.IsFollowing(userId, target.Id);

        if (on && !eligible)
        {
            throw AppException.BadRequest(kind == UserListKind.CloseFriends
                ? "Close friends can only be people who follow you."
                : "Favourites can only be accounts you follow.");
        }

        var existing = await db.UserListEntries
            .FirstOrDefaultAsync(e => e.OwnerId == userId && e.Kind == kind && e.UserId == target.Id, ct);

        if (on && existing is null)
        {
            db.UserListEntries.Add(new UserListEntry { OwnerId = userId, UserId = target.Id, Kind = kind });
        }
        else if (!on && existing is not null)
        {
            db.UserListEntries.Remove(existing);
        }

        await db.SaveChangesAsync(ct);

        return await db.UserListEntries.CountAsync(e => e.OwnerId == userId && e.Kind == kind, ct);
    }

    public async Task<ActivitySummary> ActivityAsync(int userId, CancellationToken ct = default)
    {
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct)
                   ?? throw AppException.NotFound();

        var graph = await graphProvider.GetAsync(ct);

        return new ActivitySummary
        {
            Posts = user.PostCount,
            LikesGiven = await db.PostLikes.CountAsync(l => l.UserId == userId, ct),
            CommentsWritten = await db.Comments.CountAsync(c => c.AuthorId == userId, ct),
            Saved = await db.SavedPosts.CountAsync(s => s.UserId == userId, ct),
            MessagesSent = await db.Messages.CountAsync(m => m.SenderId == userId && !m.IsUnsent, ct),
            Conversations = await db.ConversationMembers
                .CountAsync(m => m.UserId == userId && m.State == MemberState.Accepted && !m.IsHidden, ct),
            Following = user.FollowingCount,
            Followers = user.FollowerCount,
            Friends = graph.FriendCount(userId),
            JoinedAt = user.CreatedAt
        };
    }

    // ---------------------------------------------------------------- internals

    private async Task<SettingsResponse> DescribeAsync(User user, CancellationToken ct) => new()
    {
        IsPrivate = user.IsPrivate,
        MessagesFrom = user.MessagesFrom.ToString(),
        CommentsFrom = user.CommentsFrom.ToString(),
        ShowActivityStatus = user.ShowActivityStatus,
        ShowReadReceipts = user.ShowReadReceipts,
        HideLikeCounts = user.HideLikeCounts,
        HiddenWords = user.HiddenWords,
        CloseFriendCount = await db.UserListEntries
            .CountAsync(e => e.OwnerId == user.Id && e.Kind == UserListKind.CloseFriends, ct),
        FavoriteCount = await db.UserListEntries
            .CountAsync(e => e.OwnerId == user.Id && e.Kind == UserListKind.Favorites, ct),
        BlockedCount = await db.Blocks.CountAsync(b => b.BlockerId == user.Id, ct),
        MutedCount = await db.Mutes.CountAsync(m => m.MuterId == user.Id, ct)
    };

    private static ListMember Describe(UserRelation relation, bool onList) => new()
    {
        Id = relation.Id,
        Username = relation.Username,
        FullName = relation.FullName,
        AvatarUrl = relation.AvatarUrl,
        IsPrivate = relation.IsPrivate,
        IsVerified = relation.IsVerified,
        IsMe = relation.IsMe,
        IsFollowing = relation.IsFollowing,
        FollowRequested = relation.FollowRequested,
        FollowsYou = relation.FollowsYou,
        RequestedYou = relation.RequestedYou,
        IsFriend = relation.IsFriend,
        OnList = onList
    };

    private static Audience ParseAudience(string value) =>
        Enum.TryParse<Audience>(value, ignoreCase: true, out var parsed)
            ? parsed
            : throw AppException.BadRequest($"'{value}' is not one of Everyone, Following, Friends or NoOne.");
}
