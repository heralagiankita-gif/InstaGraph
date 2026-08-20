using InstaGraph.Api.Common;
using Microsoft.Extensions.Options;

namespace InstaGraph.Api.Graph;

/// <summary>Why an account was suggested. Drives both the wording and the tabs on the discover screen.</summary>
public enum SuggestionCategory
{
    /// <summary>They already follow you. The edge exists in one direction and not the other.</summary>
    FollowsYou,

    /// <summary>Reached through accounts you follow — two hops, weighted by Adamic–Adar.</summary>
    MutualFriends,

    /// <summary>Endorsed by your circle of trust, per SALSA over the bipartite circle graph.</summary>
    PopularInCircle,

    /// <summary>Reached by the random walk beyond two hops — same crowd, no direct mutual.</summary>
    ExtendedNetwork,

    /// <summary>Label propagation put them in the same cluster as you.</summary>
    SameCommunity,

    /// <summary>Nothing personal reaches them; they are simply central in the graph as a whole.</summary>
    Popular
}

/// <summary>One signal's raw reading and what it actually contributed to the final score.</summary>
public record SignalContribution(string Name, double Value, double Contribution);

/// <summary>One ranked candidate, carrying the whole derivation that produced it.</summary>
public record GraphSuggestion(
    int UserId,
    double Score,
    SuggestionCategory Category,
    IReadOnlyList<int> Via,
    int MutualCount,
    bool FollowsYou,
    IReadOnlyList<SignalContribution> Signals)
{
    /// <summary>Hops along the shortest route, filled in for the handful that survive the ranking.</summary>
    public int Distance { get; init; } = -1;
}

public interface ISuggestionEngine
{
    /// <summary>
    /// Ranks who is worth following.
    /// <para>
    /// <paramref name="discoverable"/> is the set of accounts that may be offered to somebody the graph
    /// knows nothing about. It is only consulted for the cold-start fallback — once there is a route to
    /// an account, the route is the justification and this does not apply.
    /// </para>
    /// </summary>
    IReadOnlyList<GraphSuggestion> Rank(
        SocialGraph graph,
        int viewerId,
        int limit,
        ISet<int>? exclude = null,
        SuggestionCategory? only = null,
        ISet<int>? discoverable = null);
}

/// <summary>
/// Blends the graph's several link-prediction signals into one ranking.
/// <para>
/// No single measure is right on its own. Adamic–Adar is precise but blind past two hops. The random walk
/// sees the whole neighbourhood but drifts toward whatever is centrally placed. SALSA finds what your
/// circle endorses but needs a circle to exist first. Reciprocity is the strongest signal there is and
/// only ever applies to a handful of people. So each is computed separately, normalised against the best
/// reading in the same candidate pool, and combined with a weight that lives in configuration — because
/// the only way to understand what one of these does is to change it and look at the result.
/// </para>
/// <para>
/// Everything here is derived from the edge set. Nothing reads a caption, a photo or a profile.
/// </para>
/// </summary>
public class SuggestionEngine(IOptions<GraphSettings> options) : ISuggestionEngine
{
    private readonly GraphSettings _settings = options.Value;

    public IReadOnlyList<GraphSuggestion> Rank(
        SocialGraph graph,
        int viewerId,
        int limit,
        ISet<int>? exclude = null,
        SuggestionCategory? only = null,
        ISet<int>? discoverable = null)
    {
        var wall = graph.WalledFor(viewerId);
        var following = graph.Following(viewerId).ToHashSet();

        bool Ineligible(int id) =>
            id == viewerId
            || following.Contains(id)
            || wall.Contains(id)
            || !graph.Contains(id)
            || (exclude is not null && exclude.Contains(id));

        // ---------------------------------------------------------------- signals

        var twoHop = graph.AdamicAdar(viewerId, exclude);
        var walk = graph.PersonalizedPageRank(viewerId, _settings.RestartProbability, _settings.WalkDepth);
        var circle = graph.CircleAuthorities(viewerId, _settings.CircleOfTrustSize, seed: walk);
        var reciprocal = graph.FollowsYouOnly(viewerId).Where(id => !Ineligible(id)).ToHashSet();
        var myCommunity = graph.CommunityOf(viewerId);

        var candidates = new HashSet<int>(reciprocal);
        candidates.UnionWith(twoHop.Keys);
        candidates.UnionWith(walk.Keys);
        candidates.UnionWith(circle.Keys);
        candidates.RemoveWhere(Ineligible);

        // A brand-new account is an isolated node — no edges to walk, so no personal signal exists at
        // all. Global PageRank is the only honest answer left, and it is still a graph answer: influence
        // measured by who endorses you rather than by a follower count.
        //
        // But "everybody, ordered by influence" is the wrong pool to draw that from once this is hosted
        // somewhere real. On a young site every account has the same influence — none — so the fallback
        // degenerates into handing each new arrival the complete member list, including accounts that
        // have never posted anything and people who would rather not be offered up to strangers.
        //
        // So the bootstrap is drawn from whoever the caller says is discoverable, and if that set is
        // empty then so is the answer. An empty suggestion list is a true statement about a new site;
        // a list of everybody who has ever signed up is not.
        if (candidates.Count < limit)
        {
            foreach (var id in graph.MostInfluential(limit * 6))
            {
                if (!Ineligible(id) && (discoverable is null || discoverable.Contains(id)))
                {
                    candidates.Add(id);
                }
            }
        }

        if (candidates.Count == 0)
        {
            return [];
        }

        // ------------------------------------------------------------ normalising

        // Each signal is on its own scale — an Adamic–Adar sum and a random-walk probability are not
        // comparable numbers — so every reading is expressed as a fraction of the best reading in this
        // pool before any of them are added together.
        var maxTwoHop = Max(twoHop.Values.Select(e => e.Score));
        var maxWalk = Max(walk.Values);
        var maxCircle = Max(circle.Values);
        var maxFollowers = Max(candidates.Select(id => (double)graph.Followers(id).Length));

        var scored = new List<GraphSuggestion>(candidates.Count);

        foreach (var candidate in candidates)
        {
            twoHop.TryGetValue(candidate, out var evidence);

            var aa = (evidence?.Score ?? 0) / maxTwoHop;
            var ppr = walk.GetValueOrDefault(candidate) / maxWalk;
            var authority = circle.GetValueOrDefault(candidate) / maxCircle;
            var followsYou = reciprocal.Contains(candidate);
            var sameCommunity = graph.CommunityOf(candidate) == myCommunity;
            var followers = graph.Followers(candidate).Length;

            // Two different readings of the same number, and they are not interchangeable.
            //
            // "Influence" is relative: how well followed is this account compared with the others in
            // front of me right now. That is the right question for a reward, because it is what makes
            // one candidate a better bet than another.
            //
            // "Celebrity" is absolute: is this account famous enough that recommending it tells nobody
            // anything. That has to be measured against a fixed scale, because the whole point of the
            // damping is to stop every list converging on the same handful of accounts — and whether
            // that is happening cannot be judged from inside a pool of three.
            var fame = Math.Log(1 + followers) / Math.Log(1 + maxFollowers);

            var celebrity = Math.Min(
                1.0,
                Math.Log(1 + followers) / Math.Log(1 + Math.Max(2, _settings.CelebrityFollowers)));

            var signals = new List<SignalContribution>(7)
            {
                new("Mutual connections", aa, aa * _settings.AdamicAdarWeight),
                new("Network proximity", ppr, ppr * _settings.PageRankWeight),
                new("Endorsed by your circle", authority, authority * _settings.CircleAuthorityWeight),
                new("Follows you", followsYou ? 1 : 0, (followsYou ? 1 : 0) * _settings.ReciprocityWeight),
                new("Same community", sameCommunity ? 1 : 0, (sameCommunity ? 1 : 0) * _settings.CommunityWeight),
                new("Influence", fame, fame * _settings.PopularityWeight),

                // Damped on the absolute scale, so an account with one follower is not treated as a
                // celebrity merely for being the most followed of three.
                new("Celebrity damping", celebrity, -celebrity * _settings.CelebrityPenalty)
            };

            scored.Add(new GraphSuggestion(
                candidate,
                signals.Sum(s => s.Contribution),
                Categorise(followsYou, aa, authority, ppr, sameCommunity),
                evidence?.Via ?? [],
                evidence?.MutualCount ?? 0,
                followsYou,
                signals));
        }

        // ------------------------------------------------- similarity on the top slice

        // Jaccard needs both accounts' full following lists, so it is only worth computing for candidates
        // that are already in contention. Below the cut it could not change the order anyway.
        var shortlist = scored
            .OrderByDescending(s => s.Score)
            .Take(Math.Max(limit * 4, _settings.CandidatePoolSize))
            .ToList();

        var refined = new List<GraphSuggestion>(shortlist.Count);

        foreach (var suggestion in shortlist)
        {
            var similarity = graph.FollowingSimilarity(viewerId, suggestion.UserId);
            var contribution = similarity * _settings.JaccardWeight;

            var signals = suggestion.Signals
                .Append(new SignalContribution("Shared interests", similarity, contribution))
                .ToList();

            refined.Add(suggestion with { Score = suggestion.Score + contribution, Signals = signals });
        }

        // The tie-breaks matter on a young graph and change nothing on an established one.
        //
        // With no edges anywhere, every graph signal reads zero and every candidate scores exactly the
        // same — so the order would be whatever the candidate pool happened to enumerate, which is
        // registration order. That is the least useful answer available: it buries whoever is actually
        // using the app under whoever signed up first.
        //
        // Falling back to follower count and then to recency is the same thing every real network does
        // when it has no personal signal to go on. It is a prior, not a ranking, and it stops applying
        // the moment a single edge exists to say something better.
        var ordered = refined
            .Where(s => only is null || s.Category == only)
            .OrderByDescending(s => s.Score)
            .ThenByDescending(s => graph.Followers(s.UserId).Length)
            .ThenByDescending(s => s.UserId)
            .ToList();

        var diversified = Diversify(ordered, limit, only is not null);

        // The route is worth reconstructing only for what survives — a BFS each is fine for ten rows.
        return diversified
            .Select(s => s with { Distance = graph.Distance(viewerId, s.UserId, maxDepth: 4) })
            .ToList();
    }

    /// <summary>
    /// Which signal did the most work. What a person is told has to be the reason the account actually
    /// rose, not whichever line is easiest to write.
    /// </summary>
    private SuggestionCategory Categorise(
        bool followsYou, double adamicAdar, double authority, double walk, bool sameCommunity)
    {
        if (followsYou)
        {
            return SuggestionCategory.FollowsYou;
        }

        var contributions = new (SuggestionCategory Category, double Weight)[]
        {
            (SuggestionCategory.MutualFriends, adamicAdar * _settings.AdamicAdarWeight),
            (SuggestionCategory.PopularInCircle, authority * _settings.CircleAuthorityWeight),
            (SuggestionCategory.ExtendedNetwork, walk * _settings.PageRankWeight),
            (SuggestionCategory.SameCommunity, (sameCommunity ? 1 : 0) * _settings.CommunityWeight)
        };

        var best = contributions.MaxBy(c => c.Weight);

        return best.Weight <= 0 ? SuggestionCategory.Popular : best.Category;
    }

    /// <summary>
    /// Stops one well-connected friend from filling the whole list.
    /// <para>
    /// Score alone would hand every slot to whichever intermediary follows the most people, because every
    /// account they follow inherits the same evidence. Capping how many suggestions may arrive through the
    /// same person costs a little ranking accuracy and buys a list that is actually worth reading.
    /// Anything held back is appended rather than discarded, so nothing is lost — only reordered.
    /// </para>
    /// </summary>
    private List<GraphSuggestion> Diversify(List<GraphSuggestion> ordered, int limit, bool singleCategory)
    {
        var perIntermediary = new Dictionary<int, int>();
        var perCategory = new Dictionary<SuggestionCategory, int>();
        var picked = new List<GraphSuggestion>(limit);
        var deferred = new List<GraphSuggestion>();

        // Within a single tab everything already shares a category, so only the intermediary cap applies.
        var categoryCap = singleCategory ? int.MaxValue : Math.Max(2, (int)Math.Ceiling(limit / 2.0));

        foreach (var suggestion in ordered)
        {
            if (picked.Count == limit)
            {
                break;
            }

            var via = suggestion.Via.Count > 0 ? suggestion.Via[0] : 0;

            perIntermediary.TryGetValue(via, out var fromVia);
            perCategory.TryGetValue(suggestion.Category, out var fromCategory);

            if ((via != 0 && fromVia >= _settings.MaxPerIntermediary) || fromCategory >= categoryCap)
            {
                deferred.Add(suggestion);
                continue;
            }

            perIntermediary[via] = fromVia + 1;
            perCategory[suggestion.Category] = fromCategory + 1;
            picked.Add(suggestion);
        }

        foreach (var suggestion in deferred)
        {
            if (picked.Count == limit)
            {
                break;
            }

            picked.Add(suggestion);
        }

        return picked;
    }

    private static double Max(IEnumerable<double> values)
    {
        var max = 0.0;

        foreach (var value in values)
        {
            if (value > max)
            {
                max = value;
            }
        }

        // Never zero: every reading is divided by this, and a pool where one signal never fired should
        // contribute nothing rather than blow up.
        return max <= 0 ? 1 : max;
    }
}
