using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Graph;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace InstaGraph.Api.Services;

public interface IGraphInsightsService
{
    Task<IReadOnlyList<SuggestedUser>> SuggestionsAsync(
        int viewerId, int limit, SuggestionCategory? category = null, CancellationToken ct = default);

    Task<ConnectionPathResponse> PathAsync(int viewerId, string username, CancellationToken ct = default);

    Task<NetworkResponse> NetworkAsync(int viewerId, int depth, int limit, CancellationToken ct = default);

    Task<NetworkStatsResponse> StatsAsync(int viewerId, CancellationToken ct = default);

    Task<GraphVersionResponse> VersionAsync(CancellationToken ct = default);

    Task<Page<UserRelation>> MutualsAsync(
        int viewerId, string username, int page, int pageSize, CancellationToken ct = default);
}

/// <summary>
/// Everything the app asks of the graph that is not a feed.
/// <para>
/// The division of labour is deliberate: <see cref="SocialGraph"/> knows about nodes and edges and nothing
/// else, <see cref="ISuggestionEngine"/> decides what a good connection is worth, and this class is the
/// only place that touches the database — one round trip at the end to put names and faces on the integers
/// the graph returned. Nothing in the graph layer knows what a username is.
/// </para>
/// </summary>
public class GraphInsightsService(
    AppDbContext db,
    IGraphSnapshotProvider graphProvider,
    IRelationshipReader relationships,
    ISuggestionEngine engine,
    IOptions<GraphSettings> options) : IGraphInsightsService
{
    private readonly GraphSettings _settings = options.Value;

    // ---------------------------------------------------------------- suggestions

    public async Task<IReadOnlyList<SuggestedUser>> SuggestionsAsync(
        int viewerId, int limit, SuggestionCategory? category = null, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);

        // Accounts with a request already in flight should not be suggested again.
        var pending = await db.Follows
            .Where(f => f.FollowerId == viewerId && f.IsPending)
            .Select(f => f.FolloweeId)
            .ToListAsync(ct);

        // Who may be offered to somebody with no connections at all.
        //
        // Two conditions, both of them things the account did rather than things inferred about it: it is
        // public, and it has posted something. A private account has said it does not want to be found
        // this way, and an account with nothing on it has given nobody a reason to follow it — putting
        // either in front of a stranger is noise at best and an exposed member list at worst.
        //
        // This is only the cold-start pool. It does not narrow anything the graph found a route to.
        var discoverable = (await db.Users
            .AsNoTracking()
            .Where(u => u.IsActive && !u.IsPrivate && u.PostCount > 0)
            .Select(u => u.Id)
            .ToListAsync(ct)).ToHashSet();

        var ranked = engine.Rank(graph, viewerId, limit, pending.ToHashSet(), category, discoverable);

        if (ranked.Count == 0)
        {
            return [];
        }

        // One round trip for every account named anywhere in the result, suggestions and intermediaries.
        var neededIds = ranked
            .SelectMany(s => s.Via.Append(s.UserId))
            .Distinct()
            .ToList();

        var users = await db.Users
            .AsNoTracking()
            .Where(u => neededIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        // The ranking already refuses to suggest anybody the viewer follows, but the card is told the
        // relationship anyway. A follow button that infers its own state from "this row exists" is a
        // button that will eventually be wrong.
        var map = await relationships.ForAsync(viewerId, neededIds, ct);

        var results = new List<SuggestedUser>(ranked.Count);

        foreach (var suggestion in ranked)
        {
            if (!users.TryGetValue(suggestion.UserId, out var user))
            {
                continue;
            }

            var via = suggestion.Via
                .Where(users.ContainsKey)
                .Select(id => users[id].ToSummary())
                .ToList();

            results.Add(new SuggestedUser
            {
                Id = user.Id,
                Username = user.Username,
                FullName = user.FullName,
                AvatarUrl = user.AvatarUrl,
                IsPrivate = user.IsPrivate,
                IsVerified = user.IsVerified,
                IsMe = user.Id == viewerId,
                IsFollowing = map.IsFollowing(user.Id),
                FollowRequested = map.FollowRequested(user.Id),
                FollowsYou = map.FollowsYou(user.Id),
                RequestedYou = map.RequestedYou(user.Id),
                IsFriend = map.IsFriend(user.Id),
                MutualCount = suggestion.MutualCount,
                Category = suggestion.Category.ToString(),
                CategoryLabel = Label(suggestion.Category),
                Score = Math.Round(suggestion.Score, 4),
                Distance = suggestion.Distance,
                FollowerCount = user.FollowerCount,
                Via = via,
                Reason = Describe(suggestion, via, user, _settings),
                Signals = suggestion.Signals
                    // A signal that read zero explains nothing, so it is not shown.
                    .Where(s => Math.Abs(s.Contribution) > 0.0001)
                    .OrderByDescending(s => Math.Abs(s.Contribution))
                    .Select(s => new SignalBreakdown
                    {
                        Name = s.Name,
                        Value = Math.Round(s.Value, 4),
                        Contribution = Math.Round(s.Contribution, 4)
                    })
                    .ToList()
            });
        }

        return results;
    }

    /// <summary>The tab title, and the chip on the card.</summary>
    public static string Label(SuggestionCategory category) => category switch
    {
        SuggestionCategory.FollowsYou => "Follows you",
        SuggestionCategory.MutualFriends => "Friends of friends",
        SuggestionCategory.PopularInCircle => "Popular in your circle",
        SuggestionCategory.ExtendedNetwork => "In your extended network",
        SuggestionCategory.SameCommunity => "Same community",
        _ => "Suggested for you"
    };

    /// <summary>
    /// Turns the ranking into the line a person actually reads. Named intermediaries where they exist,
    /// because "followed by somebody you know" is checkable and "recommended for you" is not.
    /// </summary>
    /// <summary>
    /// The line under a suggested account, in Instagram's own words.
    /// <para>
    /// Wherever the graph found a route, the route is what gets said — "Followed by nila + 2 more" — for
    /// the same reason the connection path is shown on a profile: naming the person it came through is
    /// evidence, where a category is only a claim.
    /// </para>
    /// <para>
    /// The fallback matters more than it looks. On a young graph there are no intermediaries yet, so
    /// nearly every row lands here — and telling somebody an account is "popular" when the whole site has
    /// four accounts on it is a lie the app can be caught in immediately. Instagram says
    /// <em>Suggested for you</em>, and says <em>New to Instagram</em> for accounts that have only just
    /// arrived, which is both true and the more useful thing to know.
    /// </para>
    /// </summary>
    private static string Describe(
        GraphSuggestion suggestion, IReadOnlyList<UserSummary> via, User user, GraphSettings settings)
    {
        if (suggestion.FollowsYou)
        {
            return via.Count > 0
                ? $"Follows you · also followed by {via[0].Username}"
                : "Follows you";
        }

        if (via.Count > 0)
        {
            var extra = suggestion.MutualCount - 1;

            return extra > 0
                ? $"Followed by {via[0].Username} + {extra} more"
                : $"Followed by {via[0].Username}";
        }

        // Nothing above matched, so the graph has found no relationship to describe at all: they do not
        // follow the viewer, and there is no route to them through anybody.
        //
        // Before falling back to a generic line, there is one thing left that is worth saying and is
        // demonstrably true — that the account has only just arrived. It takes both conditions: recent
        // enough, and not yet followed by more than a handful. Either on its own describes plenty of
        // accounts that nobody would call new.
        var newAccount =
            user.FollowerCount <= settings.NewAccountFollowers
            && user.CreatedAt >= DateTime.UtcNow.AddDays(-settings.NewAccountDays);

        if (newAccount)
        {
            return "New to InstaGraph";
        }

        return suggestion.Category switch
        {
            SuggestionCategory.PopularInCircle => "Popular with people you follow",
            SuggestionCategory.ExtendedNetwork => "In your extended network",
            SuggestionCategory.SameCommunity => "Moves in the same circles as you",
            _ => "Suggested for you"
        };
    }

    // ----------------------------------------------------------------------- path

    public async Task<ConnectionPathResponse> PathAsync(
        int viewerId, string username, CancellationToken ct = default)
    {
        var target = await FindAsync(username, ct);
        var graph = await graphProvider.GetAsync(ct);

        // Same rule as the profile: if they blocked you, nothing about them resolves.
        if (target.Id != viewerId && graph.IsWalled(viewerId, target.Id))
        {
            throw AppException.NotFound("That account does not exist.");
        }

        var path = graph.ShortestPath(viewerId, target.Id);

        var users = path.Count == 0
            ? []
            : await db.Users
                .AsNoTracking()
                .Where(u => path.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id, ct);

        var hops = path.Count == 0 ? -1 : path.Count - 1;

        return new ConnectionPathResponse
        {
            Connected = path.Count > 0,
            Degrees = hops,
            Path = path.Where(users.ContainsKey).Select(id => users[id].ToSummary()).ToList(),
            Summary = Summarise(hops, path, users),
            MutualCount = target.Id == viewerId ? 0 : graph.MutualCount(viewerId, target.Id),
            FollowsYou = graph.IsFollowing(target.Id, viewerId),
            IsFollowing = graph.IsFollowing(viewerId, target.Id),
            SameCommunity = graph.CommunityOf(viewerId) == graph.CommunityOf(target.Id),
            Similarity = Math.Round(graph.FollowingSimilarity(viewerId, target.Id), 4)
        };
    }

    private static string Summarise(int hops, IReadOnlyList<int> path, IReadOnlyDictionary<int, User> users)
    {
        if (hops < 0)
        {
            return "No route through the graph";
        }

        if (hops == 0)
        {
            return "This is you";
        }

        if (hops == 1)
        {
            return "1st degree · you follow them";
        }

        // The interesting part of a route is who is in the middle, so that is what gets named.
        var middle = path
            .Skip(1)
            .Take(path.Count - 2)
            .Where(users.ContainsKey)
            .Select(id => users[id].Username)
            .ToList();

        var ordinal = hops switch
        {
            2 => "2nd",
            3 => "3rd",
            _ => $"{hops}th"
        };

        return middle.Count == 0
            ? $"{ordinal} degree"
            : $"{ordinal} degree · through {string.Join(" → ", middle)}";
    }

    // -------------------------------------------------------------------- network

    public async Task<NetworkResponse> NetworkAsync(
        int viewerId, int depth, int limit, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);
        var cap = Math.Clamp(limit, 10, Math.Max(10, _settings.NetworkNodeLimit * 3));

        var ego = graph.Ego(viewerId, Math.Clamp(depth, 1, 3), cap);

        var ids = ego.Nodes.Select(n => n.UserId).ToList();

        var users = await db.Users
            .AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        // Influence is drawn as node size, so what matters is the ratio inside this picture, not the
        // absolute PageRank — which is a number nobody can read.
        var peak = ego.Nodes.Count == 0 ? 1 : Math.Max(ego.Nodes.Max(n => n.Influence), 1e-9);

        var nodes = ego.Nodes
            .Where(n => users.ContainsKey(n.UserId))
            .Select(n =>
            {
                var user = users[n.UserId];

                return new NetworkNode
                {
                    Id = user.Id,
                    Username = user.Username,
                    FullName = user.FullName,
                    AvatarUrl = user.AvatarUrl,
                    IsPrivate = user.IsPrivate,
                    IsVerified = user.IsVerified,
                    Hop = n.Hop,
                    Community = n.Community,
                    Influence = Math.Round(n.Influence / peak, 4),
                    FollowerCount = user.FollowerCount,
                    IsYou = n.UserId == viewerId,
                    IsFollowing = graph.IsFollowing(viewerId, n.UserId),
                    FollowsYou = graph.IsFollowing(n.UserId, viewerId)
                };
            })
            .ToList();

        var drawn = nodes.Select(n => n.Id).ToHashSet();

        var edges = ego.Edges
            .Where(e => drawn.Contains(e.From) && drawn.Contains(e.To))
            .Select(e => new NetworkEdge
            {
                Source = e.From,
                Target = e.To,
                Weight = e.Weight,
                Mutual = e.Mutual
            })
            .ToList();

        return new NetworkResponse
        {
            Nodes = nodes,
            Edges = edges,
            CommunityCount = nodes.Select(n => n.Community).Distinct().Count(),
            Truncated = graph.ReachWithin(viewerId, Math.Clamp(depth, 1, 3)) > nodes.Count - 1
        };
    }

    public async Task<NetworkStatsResponse> StatsAsync(int viewerId, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);
        var stats = graph.Stats(viewerId);

        return new NetworkStatsResponse
        {
            Following = stats.Following,
            Followers = stats.Followers,
            Mutual = stats.Mutual,
            Reach1 = stats.Reach1,
            Reach2 = stats.Reach2,
            Reach3 = stats.Reach3,
            Reciprocity = Math.Round(stats.Reciprocity, 4),
            Clustering = Math.Round(stats.Clustering, 4),
            CommunitySize = stats.CommunitySize,
            InfluencePercentile = Math.Round(stats.InfluencePercentile, 4),
            GraphNodes = graph.NodeCount,
            GraphEdges = graph.EdgeCount,
            GraphCommunities = graph.CommunityCount,
            GraphVersion = graph.Version,
            SnapshotBuiltAt = graph.BuiltAt
        };
    }

    /// <summary>
    /// Four numbers and a hash. Deliberately touches nothing lazy, so polling it costs a dictionary read
    /// and never a whole-graph pass.
    /// </summary>
    public async Task<GraphVersionResponse> VersionAsync(CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);

        return new GraphVersionResponse
        {
            Version = graph.Version,
            Nodes = graph.NodeCount,
            Edges = graph.EdgeCount,
            Blocks = graph.BlockCount,
            BuiltAt = graph.BuiltAt
        };
    }

    // -------------------------------------------------------------------- mutuals

    public async Task<Page<UserRelation>> MutualsAsync(
        int viewerId, string username, int page, int pageSize, CancellationToken ct = default)
    {
        var target = await FindAsync(username, ct);
        var graph = await graphProvider.GetAsync(ct);

        if (graph.IsWalled(viewerId, target.Id))
        {
            throw AppException.NotFound("That account does not exist.");
        }

        // The intersection is computed in memory from two sorted lists; only the page being read is
        // fetched from the database.
        var mutualIds = graph.MutualConnections(viewerId, target.Id);

        var window = mutualIds
            .OrderByDescending(id => graph.EdgeWeight(viewerId, id))
            .ThenByDescending(graph.Influence)
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .ToList();

        var hasMore = window.Count > pageSize;
        var ids = window.Take(pageSize).ToList();

        var users = await db.Users
            .AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        var map = await relationships.ForAsync(viewerId, ids, ct);

        return new Page<UserRelation>
        {
            // Ordered by the graph, not by the database, so the ranking above survives the round trip.
            Items = ids.Where(users.ContainsKey).Select(id => map.Describe(users[id])).ToList(),
            PageNumber = page,
            PageSize = pageSize,
            HasMore = hasMore
        };
    }

    private async Task<User> FindAsync(string username, CancellationToken ct)
    {
        var handle = (username ?? string.Empty).Trim().ToLowerInvariant();

        return await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Username == handle, ct)
               ?? throw AppException.NotFound("That account does not exist.");
    }
}
