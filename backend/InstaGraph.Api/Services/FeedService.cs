using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Graph;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace InstaGraph.Api.Services;

public interface IFeedService
{
    Task<Page<PostResponse>> HomeAsync(int viewerId, int page, int pageSize, CancellationToken ct = default);
    Task<Page<PostResponse>> ExploreAsync(int viewerId, int page, int pageSize, CancellationToken ct = default);
    Task<Page<PostResponse>> ReelsAsync(int viewerId, int page, int pageSize, CancellationToken ct = default);
    Task<IReadOnlyList<HighlightResponse>> HighlightsAsync(int viewerId, CancellationToken ct = default);
}

/// <summary>
/// The home feed. Candidates come from the graph — the accounts you follow, plus a slice of what they
/// follow — and the order comes from three signals multiplied together: how strong your tie to the author
/// is, how much the post has drawn, and how fresh it is.
/// <para>
/// That is the same shape as the original EdgeRank: affinity × weight × time decay. The real version at
/// this point is a learned model over thousands of features, but the skeleton has not changed, and the
/// weights sit in appsettings.json because the only way to understand what one does is to move it.
/// </para>
/// </summary>
public class FeedService(
    AppDbContext db,
    IGraphSnapshotProvider graphProvider,
    IOptions<FeedSettings> feedSettings) : IFeedService
{
    private readonly FeedSettings _settings = feedSettings.Value;

    /// <summary>How deep the candidate pool goes before ranking. Beyond this, nothing could reach page 1.</summary>
    private const int CandidateWindow = 240;

    public async Task<Page<PostResponse>> HomeAsync(
        int viewerId, int page, int pageSize, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);
        var wall = graph.WalledFor(viewerId);

        // Muting keeps the edge and drops the content: they stay in your following count and are never
        // told, but nothing of theirs is a candidate here.
        var muted = await db.Mutes
            .Where(m => m.MuterId == viewerId)
            .Select(m => m.MutedId)
            .ToListAsync(ct);

        var hidden = wall.Concat(muted).ToHashSet();

        // Favourites: a subset of your out-edges you named yourself. The only signal in the ranking that
        // was stated rather than inferred, so it is added on top of everything the graph worked out.
        var favorites = (await db.UserListEntries
            .Where(e => e.OwnerId == viewerId && e.Kind == UserListKind.Favorites)
            .Select(e => e.UserId)
            .ToListAsync(ct)).ToHashSet();

        // Hop 1: the accounts you chose. This is the whole feed on most days.
        var directIds = graph.Following(viewerId).Where(id => !hidden.Contains(id)).ToList();
        var directSet = directIds.ToHashSet();

        // Beyond hop 1: the accounts they chose, and the accounts those chose. Without this nothing ever
        // reaches you that you did not already ask for — no post could ever spread past its author's own
        // followers.
        //
        // Which of them, though, matters as much as that there are any. Taking the first 120 out of a set
        // of two-hop accounts is an arbitrary cut; the random walk with restart orders the whole
        // neighbourhood by how much of your attention actually flows there, so the discovery slice is
        // drawn from the nearest strangers rather than from whoever happened to hash first. The walk
        // already refuses to pass through or land on a blocked account.
        var suggestedIds = graph.PersonalizedPageRank(viewerId)
            .Where(p => p.Key != viewerId && !directSet.Contains(p.Key) && !hidden.Contains(p.Key))
            .OrderByDescending(p => p.Value)
            .Take(120)
            .Select(p => p.Key)
            .ToList();

        var authorIds = directIds.Concat(suggestedIds).Append(viewerId).Distinct().ToList();

        var candidates = await db.Posts
            .AsNoTracking()
            .Include(p => p.Author)
            .Include(p => p.Hashtags).ThenInclude(h => h.Hashtag)
            .Include(p => p.Media)
            .Include(p => p.Tags).ThenInclude(t => t.User)
            .Where(p => authorIds.Contains(p.AuthorId))
            .Where(p => !p.IsArchived)
            // Somebody else's private account can only be here if you follow it, which is exactly the rule.
            .Where(p => !p.Author.IsPrivate || p.AuthorId == viewerId || directIds.Contains(p.AuthorId))
            .OrderByDescending(p => p.CreatedAt)
            .Take(CandidateWindow)
            .ToListAsync(ct);

        if (candidates.Count == 0)
        {
            // An account with no edges is an isolated node: there is genuinely nothing to traverse, so the
            // honest answer is an empty feed. Quietly serving Explore instead would hide the one thing
            // this app is built on — that the feed is made of your follows and nothing else. The client
            // turns this into a get-started screen with suggestions on it.
            return new Page<PostResponse> { Items = [], PageNumber = page, PageSize = pageSize, HasMore = false };
        }

        var now = DateTime.UtcNow;

        var ranked = candidates
            .Select(post => new Ranked(
                post,
                Score(post, viewerId, graph, directSet, favorites, now),
                !directSet.Contains(post.AuthorId) && post.AuthorId != viewerId))
            .OrderByDescending(x => x.Score)
            .ToList();

        var ordered = Interleave(
            ranked.Where(x => !x.IsSuggested).ToList(),
            ranked.Where(x => x.IsSuggested).ToList());

        var window = ordered
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .ToList();

        var hasMore = window.Count > pageSize;
        window = window.Take(pageSize).ToList();

        var ids = window.Select(x => x.Post.Id).ToList();

        var liked = (await db.PostLikes
            .Where(l => l.UserId == viewerId && ids.Contains(l.PostId))
            .Select(l => l.PostId)
            .ToListAsync(ct)).ToHashSet();

        var saved = (await db.SavedPosts
            .Where(s => s.UserId == viewerId && ids.Contains(s.PostId))
            .Select(s => s.PostId)
            .ToListAsync(ct)).ToHashSet();

        var previews = await PreviewCommentsAsync(ids, viewerId, ct);

        return new Page<PostResponse>
        {
            Items = window.Select(x => x.Post.ToResponse(
                viewerId,
                liked.Contains(x.Post.Id),
                previews.TryGetValue(x.Post.Id, out var comments) ? comments : [],
                x.IsSuggested ? "Suggested for you" : null,
                saved.Contains(x.Post.Id))).ToList(),
            PageNumber = page,
            PageSize = pageSize,
            HasMore = hasMore
        };
    }

    /// <summary>
    /// Explore: photos from accounts you do not follow. Ordered by how much the post has drawn, lifted for
    /// anything two hops away — near strangers before actual strangers.
    /// </summary>
    public async Task<Page<PostResponse>> ExploreAsync(
        int viewerId, int page, int pageSize, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);
        var following = graph.Following(viewerId).ToHashSet();
        var nearby = graph.SecondHop(viewerId);
        var walled = graph.WalledFor(viewerId).ToList();

        var candidates = await db.Posts
            .AsNoTracking()
            .Include(p => p.Author)
            .Include(p => p.Hashtags).ThenInclude(h => h.Hashtag)
            .Include(p => p.Media)
            .Include(p => p.Tags).ThenInclude(t => t.User)
            .Where(p => !p.Author.IsPrivate && p.Author.IsActive && p.AuthorId != viewerId)
            .Where(p => !p.IsArchived)
            .Where(p => !walled.Contains(p.AuthorId))
            .OrderByDescending(p => p.CreatedAt)
            .Take(CandidateWindow * 2)
            .ToListAsync(ct);

        var now = DateTime.UtcNow;

        var ordered = candidates
            .Where(p => !following.Contains(p.AuthorId))
            .Select(post => new
            {
                Post = post,
                Score = (Math.Log(1 + post.LikeCount + (post.CommentCount * 2)) * _settings.EngagementWeight)
                        + (Freshness(post.CreatedAt, now) * _settings.RecencyWeight * 0.5)
                        + (nearby.Contains(post.AuthorId) ? 2.5 : 0)
            })
            .OrderByDescending(x => x.Score)
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .ToList();

        var hasMore = ordered.Count > pageSize;
        var window = ordered.Take(pageSize).ToList();
        var ids = window.Select(x => x.Post.Id).ToList();

        var liked = (await db.PostLikes
            .Where(l => l.UserId == viewerId && ids.Contains(l.PostId))
            .Select(l => l.PostId)
            .ToListAsync(ct)).ToHashSet();

        return new Page<PostResponse>
        {
            Items = window.Select(x => x.Post.ToResponse(viewerId, liked.Contains(x.Post.Id))).ToList(),
            PageNumber = page,
            PageSize = pageSize,
            HasMore = hasMore
        };
    }

    /// <summary>
    /// Reels: every clip in the app, one after another, full screen.
    /// <para>
    /// Deliberately not the home feed with a filter on the end. The home feed answers "what have the
    /// accounts I chose posted"; this answers "what is worth watching", and it has to answer it mostly
    /// from outside that set — a vertical feed that only ever showed you people you already follow runs
    /// out after two swipes. So affinity is halved here and engagement carries most of the order, which is
    /// the same three signals as the home feed with the weights turned around.
    /// </para>
    /// </summary>
    public async Task<Page<PostResponse>> ReelsAsync(
        int viewerId, int page, int pageSize, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);
        var wall = graph.WalledFor(viewerId);

        var muted = await db.Mutes
            .Where(m => m.MuterId == viewerId)
            .Select(m => m.MutedId)
            .ToListAsync(ct);

        var hidden = wall.Concat(muted).ToHashSet();
        var following = graph.Following(viewerId).ToList();
        var nearby = graph.SecondHop(viewerId);

        var candidates = await db.Posts
            .AsNoTracking()
            .Include(p => p.Author)
            .Include(p => p.Hashtags).ThenInclude(h => h.Hashtag)
            .Include(p => p.Media)
            .Include(p => p.Tags).ThenInclude(t => t.User)
            .Where(p => p.IsReel && !p.IsArchived && p.Author.IsActive)
            // A private account's clip reaches the people who follow it and nobody else. Same rule as the
            // home feed, stated again because this query does not go through it.
            .Where(p => !p.Author.IsPrivate || p.AuthorId == viewerId || following.Contains(p.AuthorId))
            .OrderByDescending(p => p.CreatedAt)
            .Take(CandidateWindow * 2)
            .ToListAsync(ct);

        var now = DateTime.UtcNow;
        var followingSet = following.ToHashSet();

        var ordered = candidates
            .Where(p => !hidden.Contains(p.AuthorId))
            .Select(post => new
            {
                Post = post,
                Score = (Math.Log(1 + graph.EdgeWeight(viewerId, post.AuthorId))
                         * _settings.AffinityWeight * 0.5)
                        + (followingSet.Contains(post.AuthorId) ? 1.5 : 0)
                        + (nearby.Contains(post.AuthorId) ? 1.0 : 0)
                        + (Math.Log(1 + post.LikeCount + (post.CommentCount * 2) + post.ViewCount)
                           * _settings.EngagementWeight)
                        + (Freshness(post.CreatedAt, now) * _settings.RecencyWeight * 0.6)
            })
            .OrderByDescending(x => x.Score)
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .ToList();

        var hasMore = ordered.Count > pageSize;
        var window = ordered.Take(pageSize).ToList();
        var ids = window.Select(x => x.Post.Id).ToList();

        var liked = (await db.PostLikes
            .Where(l => l.UserId == viewerId && ids.Contains(l.PostId))
            .Select(l => l.PostId)
            .ToListAsync(ct)).ToHashSet();

        var saved = (await db.SavedPosts
            .Where(x => x.UserId == viewerId && ids.Contains(x.PostId))
            .Select(x => x.PostId)
            .ToListAsync(ct)).ToHashSet();

        return new Page<PostResponse>
        {
            Items = window
                .Select(x => x.Post.ToResponse(
                    viewerId,
                    liked.Contains(x.Post.Id),
                    isSaved: saved.Contains(x.Post.Id),
                    // Free here: the ranking above already needed the viewer's out-edges.
                    authorIsFollowed: followingSet.Contains(x.Post.AuthorId)))
                .ToList(),
            PageNumber = page,
            PageSize = pageSize,
            HasMore = hasMore
        };
    }

    /// <summary>
    /// The ring row across the top of the feed: everyone you follow who has posted in the last day, most
    /// recent first, each with the photo to open when you tap them.
    /// <para>
    /// Purely a one-hop question — your own out-edges and nothing further. Somebody with no follows gets
    /// an empty row, which is the honest answer rather than a row of strangers.
    /// </para>
    /// </summary>
    public async Task<IReadOnlyList<HighlightResponse>> HighlightsAsync(
        int viewerId, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);
        var wall = graph.WalledFor(viewerId);

        // A muted account keeps its edge but loses its ring, which is the whole point of muting.
        var muted = await db.Mutes
            .Where(m => m.MuterId == viewerId)
            .Select(m => m.MutedId)
            .ToListAsync(ct);

        var following = graph.Following(viewerId)
            .Where(id => !wall.Contains(id) && !muted.Contains(id))
            .ToList();

        if (following.Count == 0)
        {
            return [];
        }

        var since = DateTime.UtcNow.AddHours(-24);

        var recent = await db.Posts
            .AsNoTracking()
            .Include(p => p.Author)
            .Where(p => following.Contains(p.AuthorId) && p.CreatedAt >= since && !p.IsArchived)
            .OrderByDescending(p => p.CreatedAt)
            .ToListAsync(ct);

        // One ring per account, not one per photo — the newest is the one the ring opens.
        return recent
            .GroupBy(p => p.AuthorId)
            .Select(g => g.First())
            .OrderByDescending(p => p.CreatedAt)
            .Select(p => new HighlightResponse
            {
                User = p.Author.ToSummary(),
                LatestPostId = p.Id,
                LatestImageUrl = p.ImageUrl,
                PostedAt = p.CreatedAt
            })
            .ToList();
    }

    // ------------------------------------------------------------------ scoring

    /// <summary>A candidate post, its score, and whether it came from beyond the accounts you follow.</summary>
    private sealed record Ranked(Post Post, double Score, bool IsSuggested);

    /// <summary>
    /// Drops the two-hop posts into the feed at a fixed cadence rather than letting score decide.
    /// <para>
    /// Score alone would never place them: following somebody is itself worth several points, so every
    /// post from an account you chose outranks every post from one you did not, and the discovery slice
    /// would sit permanently below the fold. Reserving roughly one slot in four is what actually lets
    /// anything reach you from outside the set of accounts you already picked.
    /// </para>
    /// </summary>
    private List<Ranked> Interleave(List<Ranked> direct, List<Ranked> discovery)
    {
        var slice = Math.Clamp(_settings.SuggestedSlice, 0.0, 0.5);

        if (slice <= 0 || discovery.Count == 0)
        {
            return direct;
        }

        // A slice of 0.25 means every fourth slot.
        var every = Math.Max(2, (int)Math.Round(1 / slice));
        var merged = new List<Ranked>(direct.Count + discovery.Count);

        int d = 0, s = 0;

        while (d < direct.Count || s < discovery.Count)
        {
            var reserved = merged.Count > 0 && (merged.Count + 1) % every == 0;

            if (reserved && s < discovery.Count)
            {
                merged.Add(discovery[s++]);
            }
            else if (d < direct.Count)
            {
                merged.Add(direct[d++]);
            }
            else if (s < discovery.Count)
            {
                merged.Add(discovery[s++]);
            }
        }

        return merged;
    }

    private double Score(
        Post post, int viewerId, SocialGraph graph, ISet<int> direct, ISet<int> favorites, DateTime now)
    {
        // Affinity: the weight on your edge to the author, grown by every like and comment you have sent
        // their way. Log-scaled so a hundred interactions is not a hundred times one.
        var weight = graph.EdgeWeight(viewerId, post.AuthorId);
        var affinity = Math.Log(1 + weight);

        if (direct.Contains(post.AuthorId))
        {
            // Following somebody is itself a signal, before any interaction has happened.
            affinity += 1.0;
        }

        if (post.AuthorId == viewerId)
        {
            affinity += 1.5;
        }

        // The edge weight this reads includes messages: every direct message adds to InteractionScore, so
        // talking to somebody lifts their photos here without anybody having to like anything.
        if (favorites.Contains(post.AuthorId))
        {
            affinity += _settings.FavoriteBoost;
        }

        // Engagement: what everybody else did with it. Comments cost more than likes, so they count more.
        var engagement = Math.Log(1 + post.LikeCount + (post.CommentCount * 2));

        return (affinity * _settings.AffinityWeight)
               + (engagement * _settings.EngagementWeight)
               + (Freshness(post.CreatedAt, now) * _settings.RecencyWeight);
    }

    /// <summary>
    /// Exponential decay on age: 1.0 at the moment of posting, 0.5 one half-life later, and so on. Without
    /// it a post that once did well would sit at the top of the feed permanently.
    /// </summary>
    private double Freshness(DateTime createdAt, DateTime now)
    {
        var hours = Math.Max(0, (now - createdAt).TotalHours);
        return Math.Pow(0.5, hours / Math.Max(0.5, _settings.RecencyHalfLifeHours));
    }

    private async Task<Dictionary<int, List<CommentResponse>>> PreviewCommentsAsync(
        List<int> postIds, int viewerId, CancellationToken ct)
    {
        if (postIds.Count == 0)
        {
            return [];
        }

        // Two newest per post, fetched for the whole page at once and grouped in memory — one round trip
        // instead of one per card.
        var comments = await db.Comments
            .AsNoTracking()
            .Include(c => c.Author)
            .Where(c => postIds.Contains(c.PostId))
            .OrderByDescending(c => c.CreatedAt)
            .Take(postIds.Count * 4)
            .ToListAsync(ct);

        return comments
            .GroupBy(c => c.PostId)
            .ToDictionary(
                g => g.Key,
                g => g.Take(2).Reverse().Select(c => c.ToResponse(viewerId)).ToList());
    }
}
