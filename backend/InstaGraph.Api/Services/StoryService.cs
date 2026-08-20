using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Graph;
using InstaGraph.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Services;

public interface IStoryService
{
    Task<StoryResponse> CreateAsync(int userId, CreateStoryRequest request, CancellationToken ct = default);

    /// <summary>The ring row: yours first, then anybody with something unseen, then the rest.</summary>
    Task<IReadOnlyList<StoryTrayItem>> TrayAsync(int viewerId, CancellationToken ct = default);

    Task<StoryTrayItem> ByUserAsync(int viewerId, string username, CancellationToken ct = default);

    Task MarkSeenAsync(int viewerId, int storyId, CancellationToken ct = default);

    Task<IReadOnlyList<StoryViewer>> ViewersAsync(int userId, int storyId, CancellationToken ct = default);

    Task DeleteAsync(int userId, int storyId, CancellationToken ct = default);

    /// <summary>Answering a story is a direct message that carries the story it answers.</summary>
    Task<MessageResponse> ReplyAsync(int viewerId, int storyId, string text, CancellationToken ct = default);
}

/// <summary>
/// Stories.
/// <para>
/// The audience is the author's in-edges — everyone who follows them — narrowed to the close-friends
/// list when the story was marked private. That is the third audience the same edge set answers, and like
/// the other two it is not stored anywhere: it is recomputed from the adjacency lists every time somebody
/// opens the app, which is why adding a follower makes their ring appear without anything being
/// backfilled.
/// </para>
/// <para>
/// Muting is honoured here for the same reason it is honoured in the feed: the edge stays, the content
/// goes. Blocking is honoured in both directions, and a private account needs no special case at all,
/// because "your followers" is already the rule.
/// </para>
/// </summary>
public class StoryService(
    AppDbContext db,
    IGraphSnapshotProvider graphProvider,
    IImageStorage storage,
    IMessagingService messaging,
    IRealtimeNotifier realtime) : IStoryService
{
    /// <summary>How long a story lives. The one number that makes it a story rather than a post.</summary>
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);

    public async Task<StoryResponse> CreateAsync(
        int userId, CreateStoryRequest request, CancellationToken ct = default)
    {
        var author = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct)
                     ?? throw AppException.Unauthorized();

        // On disk first: a failed upload must not leave a row pointing at nothing.
        var imageUrl = await storage.SaveAsync(request.Image, ct);

        var story = new Story
        {
            AuthorId = userId,
            ImageUrl = imageUrl,
            Caption = (request.Caption ?? string.Empty).Trim(),
            CloseFriendsOnly = request.CloseFriendsOnly,
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.Add(Lifetime)
        };

        db.Stories.Add(story);
        await db.SaveChangesAsync(ct);

        story.Author = author;

        // Everybody who would see it gets told immediately, so a ring appears without a refresh.
        var audience = await AudienceOfAsync(userId, request.CloseFriendsOnly, ct);

        await realtime.ToUsersAsync(
            audience,
            RealtimeEvents.Story,
            new { userId, username = author.Username },
            ct);

        return story.ToResponse(userId, isSeen: true);
    }

    public async Task<IReadOnlyList<StoryTrayItem>> TrayAsync(int viewerId, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);
        var wall = graph.WalledFor(viewerId);

        // A muted account keeps its edge and loses its ring — the same rule the feed applies to posts.
        var muted = (await db.Mutes
            .AsNoTracking()
            .Where(m => m.MuterId == viewerId)
            .Select(m => m.MutedId)
            .ToListAsync(ct)).ToHashSet();

        var authorIds = graph.Following(viewerId)
            .Where(id => !wall.Contains(id) && !muted.Contains(id))
            .ToList();

        // Your own stories are always in the row, at the front, whether anybody else can see them or not.
        authorIds.Add(viewerId);

        var now = DateTime.UtcNow;

        var stories = await db.Stories
            .AsNoTracking()
            .Include(s => s.Author)
            .Where(s => authorIds.Contains(s.AuthorId) && s.ExpiresAt > now)
            .OrderBy(s => s.CreatedAt)
            .ToListAsync(ct);

        if (stories.Count == 0)
        {
            return [];
        }

        // Which of the private ones reach you: the close-friends lists you are actually on.
        var closeTo = (await db.UserListEntries
            .AsNoTracking()
            .Where(e => e.Kind == UserListKind.CloseFriends && e.UserId == viewerId)
            .Select(e => e.OwnerId)
            .ToListAsync(ct)).ToHashSet();

        var visible = stories
            .Where(s => s.AuthorId == viewerId || !s.CloseFriendsOnly || closeTo.Contains(s.AuthorId))
            .ToList();

        if (visible.Count == 0)
        {
            return [];
        }

        var seen = await SeenIdsAsync(viewerId, visible.Select(s => s.Id).ToList(), ct);

        return visible
            .GroupBy(s => s.AuthorId)
            .Select(group => new StoryTrayItem
            {
                User = group.First().Author.ToSummary(),
                StoryCount = group.Count(),
                HasUnseen = group.Any(s => !seen.Contains(s.Id)),
                IsMine = group.Key == viewerId,
                PreviewUrl = group.First().ImageUrl,
                LatestAt = group.Max(s => s.CreatedAt),
                Stories = group
                    .OrderBy(s => s.CreatedAt)
                    .Select(s => s.ToResponse(viewerId, seen.Contains(s.Id)))
                    .ToList()
            })
            // Yours first; then anybody with something new; then by how recent, which is the order the
            // real one uses and the only ordering that needs no explanation.
            .OrderByDescending(item => item.IsMine)
            .ThenByDescending(item => item.HasUnseen)
            .ThenByDescending(item => item.LatestAt)
            .ToList();
    }

    public async Task<StoryTrayItem> ByUserAsync(
        int viewerId, string username, CancellationToken ct = default)
    {
        var handle = username.Trim().ToLowerInvariant();

        var author = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Username == handle && u.IsActive, ct)
                     ?? throw AppException.NotFound("That account does not exist.");

        // The audience rule is about followers, and nobody follows themselves — so looking at your own
        // stories has to be exempt from it rather than caught by it.
        if (author.Id != viewerId)
        {
            await GuardCanSeeAsync(viewerId, author, ct);
        }

        var now = DateTime.UtcNow;

        var stories = await db.Stories
            .AsNoTracking()
            .Include(s => s.Author)
            .Where(s => s.AuthorId == author.Id && s.ExpiresAt > now)
            .OrderBy(s => s.CreatedAt)
            .ToListAsync(ct);

        if (author.Id != viewerId)
        {
            var onCloseFriends = await db.UserListEntries.AnyAsync(
                e => e.Kind == UserListKind.CloseFriends && e.OwnerId == author.Id && e.UserId == viewerId, ct);

            if (!onCloseFriends)
            {
                stories = stories.Where(s => !s.CloseFriendsOnly).ToList();
            }
        }

        var seen = await SeenIdsAsync(viewerId, stories.Select(s => s.Id).ToList(), ct);

        return new StoryTrayItem
        {
            User = author.ToSummary(),
            StoryCount = stories.Count,
            HasUnseen = stories.Any(s => !seen.Contains(s.Id)),
            IsMine = author.Id == viewerId,
            PreviewUrl = stories.FirstOrDefault()?.ImageUrl ?? string.Empty,
            LatestAt = stories.Count == 0 ? default : stories.Max(s => s.CreatedAt),
            Stories = stories.Select(s => s.ToResponse(viewerId, seen.Contains(s.Id))).ToList()
        };
    }

    public async Task MarkSeenAsync(int viewerId, int storyId, CancellationToken ct = default)
    {
        var story = await LoadVisibleAsync(viewerId, storyId, ct);

        // Looking at your own story is not a view. The count is what other people did.
        if (story.AuthorId == viewerId)
        {
            return;
        }

        var already = await db.StoryViews
            .AnyAsync(v => v.StoryId == storyId && v.ViewerId == viewerId, ct);

        if (already)
        {
            return;
        }

        db.StoryViews.Add(new StoryView { StoryId = storyId, ViewerId = viewerId });
        story.ViewCount++;

        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<StoryViewer>> ViewersAsync(
        int userId, int storyId, CancellationToken ct = default)
    {
        var story = await db.Stories.AsNoTracking().FirstOrDefaultAsync(s => s.Id == storyId, ct)
                    ?? throw AppException.NotFound("That story is no longer there.");

        // The list of who looked belongs to exactly one person.
        if (story.AuthorId != userId)
        {
            throw AppException.Forbidden("Only the author can see who watched a story.");
        }

        var graph = await graphProvider.GetAsync(ct);

        var views = await db.StoryViews
            .AsNoTracking()
            .Include(v => v.Viewer)
            .Where(v => v.StoryId == storyId)
            .OrderByDescending(v => v.ViewedAt)
            .ToListAsync(ct);

        return views.Select(v => new StoryViewer
        {
            User = v.Viewer.ToSummary(),
            ViewedAt = v.ViewedAt,
            FollowsYou = graph.IsFollowing(v.ViewerId, userId),
            IsFollowing = graph.IsFollowing(userId, v.ViewerId)
        }).ToList();
    }

    public async Task DeleteAsync(int userId, int storyId, CancellationToken ct = default)
    {
        var story = await db.Stories.FirstOrDefaultAsync(s => s.Id == storyId, ct)
                    ?? throw AppException.NotFound("That story is no longer there.");

        if (story.AuthorId != userId)
        {
            throw AppException.Forbidden("You can only delete your own stories.");
        }

        var views = await db.StoryViews.Where(v => v.StoryId == storyId).ToListAsync(ct);
        db.StoryViews.RemoveRange(views);

        // Replies keep their text and lose the picture they answered; the FK is nulled rather than
        // cascading, so a conversation never loses a message because a story ran out.
        await db.Messages
            .Where(m => m.SharedStoryId == storyId)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.SharedStoryId, (int?)null), ct);

        db.Stories.Remove(story);
        await db.SaveChangesAsync(ct);

        storage.Delete(story.ImageUrl);
    }

    public async Task<MessageResponse> ReplyAsync(
        int viewerId, int storyId, string text, CancellationToken ct = default)
    {
        var story = await LoadVisibleAsync(viewerId, storyId, ct);

        if (story.AuthorId == viewerId)
        {
            throw AppException.BadRequest("You cannot reply to your own story.");
        }

        var author = await db.Users.AsNoTracking().FirstAsync(u => u.Id == story.AuthorId, ct);

        // A story reply is a direct message, so it goes through exactly the same gate every other message
        // does — including landing under Requests if the author does not follow back.
        var conversation = await messaging.StartAsync(
            viewerId, new StartConversationRequest { Usernames = [author.Username] }, ct);

        var message = await messaging.SendAsync(
            viewerId,
            conversation.Id,
            new SendMessageRequest { Text = text.Trim(), SharedStoryId = storyId },
            ct);

        return message;
    }

    // ---------------------------------------------------------------- internals

    /// <summary>Loads a story only if the viewer is allowed to see it, and 404s identically if not.</summary>
    private async Task<Story> LoadVisibleAsync(int viewerId, int storyId, CancellationToken ct)
    {
        var story = await db.Stories
            .Include(s => s.Author)
            .FirstOrDefaultAsync(s => s.Id == storyId && s.ExpiresAt > DateTime.UtcNow, ct)
            ?? throw AppException.NotFound("That story is no longer there.");

        if (story.AuthorId == viewerId)
        {
            return story;
        }

        await GuardCanSeeAsync(viewerId, story.Author, ct);

        if (story.CloseFriendsOnly)
        {
            var onList = await db.UserListEntries.AnyAsync(
                e => e.Kind == UserListKind.CloseFriends
                     && e.OwnerId == story.AuthorId
                     && e.UserId == viewerId, ct);

            if (!onList)
            {
                throw AppException.NotFound("That story is no longer there.");
            }
        }

        return story;
    }

    /// <summary>
    /// The audience rule, in one place: not walled off, and an accepted edge from the viewer to the
    /// author. That single test covers private accounts too, because "your followers" already means
    /// "accounts whose edge you accepted".
    /// </summary>
    private async Task GuardCanSeeAsync(int viewerId, User author, CancellationToken ct)
    {
        var graph = await graphProvider.GetAsync(ct);

        if (graph.IsWalled(viewerId, author.Id))
        {
            throw AppException.NotFound("That account does not exist.");
        }

        if (!graph.IsFollowing(viewerId, author.Id))
        {
            throw AppException.Forbidden("Stories are only shown to followers.");
        }

        await Task.CompletedTask;
    }

    /// <summary>Who a new story should be pushed to, straight off the in-edges.</summary>
    private async Task<List<int>> AudienceOfAsync(int authorId, bool closeFriendsOnly, CancellationToken ct)
    {
        var graph = await graphProvider.GetAsync(ct);
        var wall = graph.WalledFor(authorId);

        var followers = graph.Followers(authorId).Where(id => !wall.Contains(id)).ToList();

        if (!closeFriendsOnly)
        {
            return followers;
        }

        var closeFriends = await db.UserListEntries
            .AsNoTracking()
            .Where(e => e.Kind == UserListKind.CloseFriends && e.OwnerId == authorId)
            .Select(e => e.UserId)
            .ToListAsync(ct);

        return followers.Intersect(closeFriends).ToList();
    }

    private async Task<HashSet<int>> SeenIdsAsync(
        int viewerId, IReadOnlyList<int> storyIds, CancellationToken ct)
    {
        if (storyIds.Count == 0)
        {
            return [];
        }

        var seen = await db.StoryViews
            .AsNoTracking()
            .Where(v => v.ViewerId == viewerId && storyIds.Contains(v.StoryId))
            .Select(v => v.StoryId)
            .ToListAsync(ct);

        return seen.ToHashSet();
    }
}
