using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Graph;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Services;

public interface IHighlightService
{
    /// <summary>The circles under somebody's bio. Covers only — no highlight carries its photos here.</summary>
    Task<IReadOnlyList<StoryHighlightResponse>> ListAsync(
        int viewerId, string username, CancellationToken ct = default);

    /// <summary>One highlight with everything in it, oldest first — the order it plays in.</summary>
    Task<StoryHighlightResponse> GetAsync(int viewerId, int highlightId, CancellationToken ct = default);

    Task<StoryHighlightResponse> CreateAsync(
        int userId, CreateHighlightRequest request, CancellationToken ct = default);

    Task<StoryHighlightResponse> UpdateAsync(
        int userId, int highlightId, UpdateHighlightRequest request, CancellationToken ct = default);

    Task DeleteAsync(int userId, int highlightId, CancellationToken ct = default);

    /// <summary>Your own stories, live and expired alike. Visible to you and to nobody else.</summary>
    Task<Page<StoryResponse>> ArchiveAsync(
        int userId, int page, int pageSize, CancellationToken ct = default);
}

/// <summary>
/// Story highlights, and the archive they are picked from.
/// <para>
/// A story is defined by expiring, so a highlight cannot be "a story that lasts longer" — it is a second
/// reference to one. The story keeps its own expiry and drops out of the tray on time; the highlight holds
/// a pointer that expiry does not touch. Which is why taking a story out of a highlight puts it back to
/// being expired rather than deleting it, and why putting one in does not make it reappear in anybody's
/// ring.
/// </para>
/// <para>
/// The archive falls out of the same design for free. Expired stories were never deleted — they are simply
/// never selected — so "everything I have ever posted" is the story table without the expiry filter, read
/// by its author and by nobody else.
/// </para>
/// </summary>
public class HighlightService(AppDbContext db, IGraphSnapshotProvider graphProvider) : IHighlightService
{
    public async Task<IReadOnlyList<StoryHighlightResponse>> ListAsync(
        int viewerId, string username, CancellationToken ct = default)
    {
        username = username.Trim().ToLowerInvariant();

        var owner = await db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Username == username && u.IsActive, ct)
            ?? throw AppException.NotFound("That account does not exist.");

        await GuardCanSeeAsync(viewerId, owner, ct);

        var highlights = await db.Highlights
            .AsNoTracking()
            .Where(h => h.OwnerId == owner.Id)
            .OrderByDescending(h => h.CreatedAt)
            .Select(h => new StoryHighlightResponse
            {
                Id = h.Id,
                Title = h.Title,
                CoverUrl = h.CoverUrl,
                StoryCount = h.Stories.Count,
                IsMine = h.OwnerId == viewerId,
                CreatedAt = h.CreatedAt
            })
            .ToListAsync(ct);

        // An empty highlight is one whose last story was deleted out from under it. It has nothing to
        // play, so it is not offered — the row is left alone rather than tidied away behind the owner's
        // back, and disappears properly the next time they edit it.
        return highlights.Where(h => h.StoryCount > 0).ToList();
    }

    public async Task<StoryHighlightResponse> GetAsync(
        int viewerId, int highlightId, CancellationToken ct = default)
    {
        var highlight = await db.Highlights
            .AsNoTracking()
            .Include(h => h.Owner)
            .Include(h => h.Stories).ThenInclude(x => x.Story).ThenInclude(s => s.Author)
            .FirstOrDefaultAsync(h => h.Id == highlightId, ct)
            ?? throw AppException.NotFound("That highlight is no longer there.");

        await GuardCanSeeAsync(viewerId, highlight.Owner, ct);

        var stories = highlight.Stories
            .Where(x => x.Story is not null)
            .OrderBy(x => x.Position)
            .Select(x => x.Story)
            .ToList();

        var seen = await SeenIdsAsync(viewerId, stories.Select(s => s.Id).ToList(), ct);

        return new StoryHighlightResponse
        {
            Id = highlight.Id,
            Title = highlight.Title,
            CoverUrl = highlight.CoverUrl,
            StoryCount = stories.Count,
            IsMine = highlight.OwnerId == viewerId,
            CreatedAt = highlight.CreatedAt,
            Stories = stories.Select(s => s.ToResponse(viewerId, seen.Contains(s.Id))).ToList()
        };
    }

    public async Task<StoryHighlightResponse> CreateAsync(
        int userId, CreateHighlightRequest request, CancellationToken ct = default)
    {
        var stories = await OwnStoriesAsync(userId, request.StoryIds, ct);

        if (stories.Count == 0)
        {
            throw AppException.BadRequest("Choose at least one story to keep.");
        }

        var highlight = new Highlight
        {
            OwnerId = userId,
            Title = request.Title.Trim(),
            CoverUrl = stories[0].ImageUrl
        };

        db.Highlights.Add(highlight);
        await db.SaveChangesAsync(ct);

        for (var i = 0; i < stories.Count; i++)
        {
            db.HighlightStories.Add(new HighlightStory
            {
                HighlightId = highlight.Id,
                StoryId = stories[i].Id,
                Position = i
            });
        }

        await db.SaveChangesAsync(ct);

        return await GetAsync(userId, highlight.Id, ct);
    }

    public async Task<StoryHighlightResponse> UpdateAsync(
        int userId, int highlightId, UpdateHighlightRequest request, CancellationToken ct = default)
    {
        var highlight = await db.Highlights
            .Include(h => h.Stories)
            .FirstOrDefaultAsync(h => h.Id == highlightId, ct)
            ?? throw AppException.NotFound("That highlight is no longer there.");

        if (highlight.OwnerId != userId)
        {
            throw AppException.Forbidden("You can only edit your own highlights.");
        }

        if (!string.IsNullOrWhiteSpace(request.Title))
        {
            highlight.Title = request.Title.Trim();
        }

        if (request.StoryIds is not null)
        {
            var stories = await OwnStoriesAsync(userId, request.StoryIds, ct);

            if (stories.Count == 0)
            {
                throw AppException.BadRequest("A highlight needs at least one story in it.");
            }

            // The contents are replaced wholesale rather than reconciled item by item: the editor sends
            // the list it is looking at, and afterwards that is the list. Reordering is then the same
            // operation as adding, which is one code path instead of three.
            db.HighlightStories.RemoveRange(highlight.Stories);

            for (var i = 0; i < stories.Count; i++)
            {
                db.HighlightStories.Add(new HighlightStory
                {
                    HighlightId = highlight.Id,
                    StoryId = stories[i].Id,
                    Position = i
                });
            }

            // The cover may have just been removed from under itself.
            if (stories.All(s => s.ImageUrl != highlight.CoverUrl))
            {
                highlight.CoverUrl = stories[0].ImageUrl;
            }
        }

        if (request.CoverStoryId is int coverId)
        {
            var cover = await db.Stories
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.Id == coverId && s.AuthorId == userId, ct)
                ?? throw AppException.NotFound("That story is no longer there.");

            highlight.CoverUrl = cover.ImageUrl;
        }

        await db.SaveChangesAsync(ct);

        return await GetAsync(userId, highlight.Id, ct);
    }

    public async Task DeleteAsync(int userId, int highlightId, CancellationToken ct = default)
    {
        var highlight = await db.Highlights.FirstOrDefaultAsync(h => h.Id == highlightId, ct)
                        ?? throw AppException.NotFound("That highlight is no longer there.");

        if (highlight.OwnerId != userId)
        {
            throw AppException.Forbidden("You can only delete your own highlights.");
        }

        // Only the pointers go. The stories themselves are untouched and stay in the archive, which is
        // the difference between removing a highlight and deleting what was in it.
        db.Highlights.Remove(highlight);
        await db.SaveChangesAsync(ct);
    }

    public async Task<Page<StoryResponse>> ArchiveAsync(
        int userId, int page, int pageSize, CancellationToken ct = default)
    {
        var rows = await db.Stories
            .AsNoTracking()
            .Include(s => s.Author)
            .Where(s => s.AuthorId == userId)
            .OrderByDescending(s => s.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .ToListAsync(ct);

        var hasMore = rows.Count > pageSize;
        var window = rows.Take(pageSize).ToList();

        return new Page<StoryResponse>
        {
            // Everything here is the viewer's own, so it always reads as seen and always carries its
            // view count — the archive is the one place both of those are true by construction.
            Items = window.Select(s => s.ToResponse(userId, isSeen: true)).ToList(),
            PageNumber = page,
            PageSize = pageSize,
            HasMore = hasMore
        };
    }

    // ---------------------------------------------------------------- internals

    /// <summary>
    /// The stories the request named, in the order it named them, keeping only the ones that are actually
    /// the caller's. Expiry is deliberately not a filter: putting an expired story into a highlight is the
    /// entire feature.
    /// </summary>
    private async Task<List<Story>> OwnStoriesAsync(
        int userId, IReadOnlyList<int> storyIds, CancellationToken ct)
    {
        var wanted = storyIds.Distinct().Take(100).ToList();

        if (wanted.Count == 0)
        {
            return [];
        }

        var found = await db.Stories
            .AsNoTracking()
            .Where(s => wanted.Contains(s.Id) && s.AuthorId == userId)
            .ToListAsync(ct);

        var byId = found.ToDictionary(s => s.Id);

        return wanted.Where(byId.ContainsKey).Select(id => byId[id]).ToList();
    }

    /// <summary>
    /// Who may look. A highlight sits on a profile, so it follows the profile's rule rather than the
    /// story one: public accounts are open to everybody, private ones to their followers, and a block
    /// hides the account in the same words an unknown name gets.
    /// </summary>
    private async Task GuardCanSeeAsync(int viewerId, User owner, CancellationToken ct)
    {
        if (owner.Id == viewerId)
        {
            return;
        }

        var graph = await graphProvider.GetAsync(ct);

        if (graph.IsWalled(viewerId, owner.Id))
        {
            throw AppException.NotFound("That account does not exist.");
        }

        if (owner.IsPrivate && !graph.IsFollowing(viewerId, owner.Id))
        {
            throw AppException.Forbidden("This account is private.");
        }
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
