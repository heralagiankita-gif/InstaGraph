namespace InstaGraph.Api.Graph;

/// <summary>
/// The follow graph, held in memory as adjacency lists.
/// <para>
/// The edges live in SQL, but the questions this app asks are recursive — "who do the people I follow
/// follow?" — and each hop is another self-join. So the whole edge set is loaded into two dictionaries
/// (out-edges and in-edges) and every answer is computed from those. With V accounts a matrix would cost
/// V² cells; a social network is almost entirely zeros, so lists cost O(V + E) instead and let a node's
/// neighbours be enumerated in time proportional to that node's own degree.
/// </para>
/// <para>
/// Everything below is a graph question and nothing else — no content, no text, no model. Local ones
/// (mutual connections, two-hop reach) run per request. Whole-graph ones (PageRank, communities) are
/// computed once per snapshot behind a <see cref="Lazy{T}"/> and then shared by every request that lands
/// on that snapshot.
/// </para>
/// <para>Immutable by construction: build it once, share it across requests, replace it when it goes stale.</para>
/// </summary>
public sealed class SocialGraph
{
    private static readonly int[] None = [];
    private static readonly HashSet<int> EmptyWall = [];

    private readonly Dictionary<int, int[]> _following;
    private readonly Dictionary<int, int[]> _followers;
    private readonly Dictionary<long, int> _weights;
    private readonly Dictionary<int, HashSet<int>> _walls;

    /// <summary>Every node, in a fixed order, so the whole-graph passes below are deterministic.</summary>
    private readonly int[] _ids;

    private readonly Lazy<Dictionary<int, double>> _pageRank;
    private readonly Lazy<Dictionary<int, int>> _communities;
    private readonly Lazy<Dictionary<int, int>> _communitySizes;
    private readonly Lazy<double[]> _rankLadder;

    public SocialGraph(
        IReadOnlyCollection<int> userIds,
        IReadOnlyCollection<(int From, int To, int Weight)> edges,
        IReadOnlyCollection<(int Blocker, int Blocked)>? blocks = null)
    {
        var outgoing = new Dictionary<int, List<int>>(userIds.Count);
        var incoming = new Dictionary<int, List<int>>(userIds.Count);

        foreach (var id in userIds)
        {
            outgoing[id] = [];
            incoming[id] = [];
        }

        _weights = new Dictionary<long, int>(edges.Count);

        foreach (var (from, to, weight) in edges)
        {
            // An edge whose endpoint is deactivated is simply not in the graph, which is why deactivating
            // an account makes it vanish from suggestions without any extra filtering downstream.
            if (!outgoing.ContainsKey(from) || !incoming.ContainsKey(to))
            {
                continue;
            }

            outgoing[from].Add(to);
            incoming[to].Add(from);
            _weights[Key(from, to)] = weight;
        }

        // Sorted once at build time so intersecting two lists is a linear merge rather than a hash join.
        _following = outgoing.ToDictionary(p => p.Key, p => Sorted(p.Value));
        _followers = incoming.ToDictionary(p => p.Key, p => Sorted(p.Value));

        // Blocks are stored symmetrically: whoever pressed the button, neither of the two may reach the
        // other. Held once here so no traversal has to remember to check, in both directions, every time.
        _walls = new Dictionary<int, HashSet<int>>();

        foreach (var (blocker, blocked) in blocks ?? [])
        {
            Wall(blocker).Add(blocked);
            Wall(blocked).Add(blocker);
        }

        _ids = userIds.ToArray();
        Array.Sort(_ids);

        NodeCount = userIds.Count;
        EdgeCount = _weights.Count;
        BlockCount = blocks?.Count ?? 0;
        Version = Fingerprint(_ids, _weights, blocks);

        // Deferred: a snapshot that only ever serves a profile page should not pay for a PageRank pass.
        // Published once and shared, so the first request that needs it pays and the rest read it.
        _pageRank = new Lazy<Dictionary<int, double>>(ComputePageRank, LazyThreadSafetyMode.ExecutionAndPublication);
        _communities = new Lazy<Dictionary<int, int>>(ComputeCommunities, LazyThreadSafetyMode.ExecutionAndPublication);

        _communitySizes = new Lazy<Dictionary<int, int>>(
            () => _communities.Value.Values.GroupBy(c => c).ToDictionary(g => g.Key, g => g.Count()),
            LazyThreadSafetyMode.ExecutionAndPublication);

        _rankLadder = new Lazy<double[]>(
            () =>
            {
                var ladder = _pageRank.Value.Values.ToArray();
                Array.Sort(ladder);
                return ladder;
            },
            LazyThreadSafetyMode.ExecutionAndPublication);
    }

    public int NodeCount { get; }

    public int EdgeCount { get; }

    public int BlockCount { get; }

    /// <summary>
    /// A content fingerprint of this snapshot: the same nodes, edges, weights and blocks always hash to the
    /// same value, and changing any one of them changes it.
    /// <para>
    /// This exists so a client can ask "has the graph moved?" without downloading the graph.
    /// <see cref="BuiltAt"/> cannot answer that — it changes every time the cache TTL expires, whether
    /// anything actually changed or not, so polling it would make a viewer redraw every twenty seconds for
    /// nothing. A hash of the edge set only moves when the edge set does.
    /// </para>
    /// </summary>
    public string Version { get; }

    public DateTime BuiltAt { get; } = DateTime.UtcNow;

    /// <summary>Every account in the graph, ascending. The iteration order of every whole-graph pass.</summary>
    public IReadOnlyList<int> Nodes => _ids;

    // ------------------------------------------------------------------ adjacency

    private HashSet<int> Wall(int userId)
    {
        if (!_walls.TryGetValue(userId, out var set))
        {
            _walls[userId] = set = [];
        }

        return set;
    }

    /// <summary>
    /// True when either of the two has blocked the other. Every traversal below consults this, which is
    /// what makes a block hold even along a route neither of them controls.
    /// </summary>
    public bool IsWalled(int a, int b) => _walls.TryGetValue(a, out var wall) && wall.Contains(b);

    /// <summary>Everyone this account cannot see and who cannot see them.</summary>
    public IReadOnlySet<int> WalledFor(int userId) =>
        _walls.TryGetValue(userId, out var wall) ? wall : EmptyWall;

    private static int[] Sorted(List<int> values)
    {
        var array = values.ToArray();
        Array.Sort(array);
        return array;
    }

    private static long Key(int from, int to) => ((long)from << 32) | (uint)to;

    /// <summary>
    /// FNV-1a over the whole edge set, sorted first so that the same graph always produces the same hash
    /// regardless of the order SQL happened to return the rows in. Runs once per snapshot, over data that
    /// has just been read anyway.
    /// </summary>
    private static string Fingerprint(
        int[] ids,
        Dictionary<long, int> weights,
        IReadOnlyCollection<(int Blocker, int Blocked)>? blocks)
    {
        unchecked
        {
            var hash = 14695981039346656037UL;

            void Mix(long value)
            {
                for (var shift = 0; shift < 64; shift += 8)
                {
                    hash ^= (byte)(value >> shift);
                    hash *= 1099511628211UL;
                }
            }

            Mix(ids.Length);

            foreach (var id in ids)
            {
                Mix(id);
            }

            Mix(weights.Count);

            // The weight is mixed in as well as the edge, so a like that strengthens a tie counts as a
            // change — it moves the ranking, so a viewer showing that ranking should hear about it.
            foreach (var edge in weights.Keys.Order())
            {
                Mix(edge);
                Mix(weights[edge]);
            }

            var walls = (blocks ?? []).Select(b => Key(b.Blocker, b.Blocked)).Order().ToList();
            Mix(walls.Count);

            foreach (var wall in walls)
            {
                Mix(wall);
            }

            return hash.ToString("x16");
        }
    }

    /// <summary>Everyone this account follows. O(1) lookup, then O(degree) to walk.</summary>
    public int[] Following(int userId) => _following.TryGetValue(userId, out var list) ? list : None;

    /// <summary>Everyone who follows this account.</summary>
    public int[] Followers(int userId) => _followers.TryGetValue(userId, out var list) ? list : None;

    public bool Contains(int userId) => _following.ContainsKey(userId);

    public bool IsFollowing(int from, int to) => _weights.ContainsKey(Key(from, to));

    /// <summary>True when the edge runs both ways — the closest thing this graph has to friendship.</summary>
    public bool IsMutual(int a, int b) => IsFollowing(a, b) && IsFollowing(b, a);

    /// <summary>
    /// How strong the tie is, from the likes and comments that have passed between the two. Feeds the
    /// ranking so that the friend you actually talk to outranks the account you followed once.
    /// </summary>
    public int EdgeWeight(int from, int to) => _weights.TryGetValue(Key(from, to), out var w) ? w : 0;

    // -------------------------------------------------------------- neighbourhood

    /// <summary>
    /// The people <paramref name="viewer"/> follows who also follow <paramref name="target"/> — what the
    /// profile shows as "Followed by ana_dev and 3 others".
    /// <para>
    /// Both lists are already sorted, so this walks them in step and is O(|A| + |B|), not O(|A| × |B|).
    /// </para>
    /// </summary>
    public List<int> MutualConnections(int viewer, int target)
    {
        var a = Following(viewer);
        var b = Followers(target);
        var wall = WalledFor(viewer);
        var shared = new List<int>();

        int i = 0, j = 0;

        while (i < a.Length && j < b.Length)
        {
            if (a[i] == b[j])
            {
                if (a[i] != viewer && a[i] != target && !wall.Contains(a[i]))
                {
                    shared.Add(a[i]);
                }

                i++;
                j++;
            }
            else if (a[i] < b[j])
            {
                i++;
            }
            else
            {
                j++;
            }
        }

        return shared;
    }

    /// <summary>How many people the viewer follows also follow the target. The merge above, without the list.</summary>
    public int MutualCount(int viewer, int target)
    {
        var a = Following(viewer);
        var b = Followers(target);
        var wall = WalledFor(viewer);
        int i = 0, j = 0, count = 0;

        while (i < a.Length && j < b.Length)
        {
            if (a[i] == b[j])
            {
                if (!wall.Contains(a[i]))
                {
                    count++;
                }

                i++;
                j++;
            }
            else if (a[i] < b[j])
            {
                i++;
            }
            else
            {
                j++;
            }
        }

        return count;
    }

    /// <summary>
    /// Overlap of two accounts' out-edges as a fraction of everything either of them follows —
    /// |A ∩ B| / |A ∪ B|, the Jaccard index.
    /// <para>
    /// It answers a different question from a raw mutual count: two people who each follow twelve accounts
    /// and share nine of them are far more alike than two who each follow two thousand and share nine.
    /// A count cannot tell those apart; a ratio can. Same linear merge over the two sorted lists.
    /// </para>
    /// </summary>
    public double FollowingSimilarity(int a, int b)
    {
        var left = Following(a);
        var right = Following(b);

        if (left.Length == 0 || right.Length == 0)
        {
            return 0;
        }

        int i = 0, j = 0, shared = 0;

        while (i < left.Length && j < right.Length)
        {
            if (left[i] == right[j])
            {
                shared++;
                i++;
                j++;
            }
            else if (left[i] < right[j])
            {
                i++;
            }
            else
            {
                j++;
            }
        }

        var union = left.Length + right.Length - shared;
        return union == 0 ? 0 : (double)shared / union;
    }

    /// <summary>
    /// Accounts two hops away — the pool Explore and the discovery slice of the home feed draw from. This
    /// is the mechanism by which anything reaches you at all beyond the people you already chose.
    /// </summary>
    public HashSet<int> SecondHop(int userId)
    {
        var direct = Following(userId);
        var wall = WalledFor(userId);
        var reached = new HashSet<int>();

        foreach (var friend in direct)
        {
            if (wall.Contains(friend))
            {
                continue;
            }

            foreach (var candidate in Following(friend))
            {
                if (candidate != userId && !IsFollowing(userId, candidate) && !wall.Contains(candidate))
                {
                    reached.Add(candidate);
                }
            }
        }

        return reached;
    }

    /// <summary>
    /// Accounts the edge runs both ways with: you follow them and they follow you.
    /// <para>
    /// A follow is directed, so "friend" is not a thing the edge table stores — it is the intersection of
    /// a node's out-edges with its own in-edges. Both lists are already sorted, so the answer is one
    /// linear merge rather than a lookup per neighbour, and it costs the same whether you follow ten
    /// accounts or ten thousand.
    /// </para>
    /// <para>
    /// This is the closest thing the graph has to a symmetric relationship, and it is what makes a
    /// follow-back different in kind from a follow: it closes a cycle of length two.
    /// </para>
    /// </summary>
    public List<int> Friends(int userId)
    {
        var following = Following(userId);
        var followers = Followers(userId);
        var wall = WalledFor(userId);
        var friends = new List<int>();

        int i = 0, j = 0;

        while (i < following.Length && j < followers.Length)
        {
            if (following[i] == followers[j])
            {
                if (!wall.Contains(following[i]))
                {
                    friends.Add(following[i]);
                }

                i++;
                j++;
            }
            else if (following[i] < followers[j])
            {
                i++;
            }
            else
            {
                j++;
            }
        }

        return friends;
    }

    /// <summary>How many edges from this account run both ways.</summary>
    public int FriendCount(int userId)
    {
        var following = Following(userId);
        int i = 0, count = 0;

        while (i < following.Length)
        {
            if (IsFollowing(following[i], userId) && !IsWalled(userId, following[i]))
            {
                count++;
            }

            i++;
        }

        return count;
    }

    /// <summary>
    /// Everyone who follows this account without being followed back — the asymmetry in the edge set.
    /// <para>
    /// The strongest suggestion signal there is, and the cheapest: they have already chosen you, so the
    /// only thing missing is the edge in the other direction. Instagram surfaces exactly this as
    /// "Follows you".
    /// </para>
    /// </summary>
    public List<int> FollowsYouOnly(int userId)
    {
        var wall = WalledFor(userId);
        var result = new List<int>();

        foreach (var follower in Followers(userId))
        {
            if (!IsFollowing(userId, follower) && !wall.Contains(follower))
            {
                result.Add(follower);
            }
        }

        return result;
    }

    // ------------------------------------------------------------- link prediction

    /// <summary>
    /// Two hops out, scored by Adamic–Adar: each shared connection contributes 1/ln(their following count)
    /// instead of 1.
    /// <para>
    /// A mutual who follows thirty accounts is real evidence you move in the same circle; one who follows
    /// fifty thousand is almost none. Counting both as "1 mutual" is what makes naive suggestions surface
    /// celebrities. The contribution is additionally scaled by how strong your own tie to the intermediary
    /// is, so a recommendation coming through the friend you talk to daily outweighs one coming through
    /// an account you followed once.
    /// </para>
    /// <para>Cost is O(d²) in your own following degree, not in the size of the network.</para>
    /// </summary>
    public Dictionary<int, TwoHopEvidence> AdamicAdar(int userId, ISet<int>? exclude = null)
    {
        var mine = Following(userId);
        var wall = WalledFor(userId);
        var found = new Dictionary<int, TwoHopEvidence>();

        foreach (var friend in mine)
        {
            // A blocked account cannot even act as the intermediary: naming them as the reason would
            // leak that they exist and who they follow.
            if (wall.Contains(friend))
            {
                continue;
            }

            var theirs = Following(friend);

            // The evidence one intermediary can supply, shared out over everyone they follow, then lifted
            // by how much you actually engage with them.
            var tie = 1.0 + Math.Log(1 + EdgeWeight(userId, friend));
            var contribution = tie / Math.Log(Math.Max(theirs.Length, 2));

            foreach (var candidate in theirs)
            {
                if (candidate == userId || IsFollowing(userId, candidate) || wall.Contains(candidate))
                {
                    continue;
                }

                if (exclude is not null && exclude.Contains(candidate))
                {
                    continue;
                }

                if (!found.TryGetValue(candidate, out var evidence))
                {
                    found[candidate] = evidence = new TwoHopEvidence();
                }

                evidence.Score += contribution;
                evidence.MutualCount++;

                // Keep a handful of intermediaries, best tie first, for the "Followed by …" line.
                evidence.Via.Add(friend);
            }
        }

        foreach (var evidence in found.Values)
        {
            evidence.Via.Sort((x, y) => EdgeWeight(userId, y).CompareTo(EdgeWeight(userId, x)));

            if (evidence.Via.Count > 5)
            {
                evidence.Via.RemoveRange(5, evidence.Via.Count - 5);
            }
        }

        return found;
    }

    /// <summary>
    /// Personalised PageRank, also called a random walk with restart: drop a walker on
    /// <paramref name="source"/>, let it follow out-edges at random, and with probability
    /// <paramref name="restart"/> at every step teleport it back to the source. The score of a node is the
    /// share of time the walker spends there.
    /// <para>
    /// This is the honest generalisation of "friends of friends". Two hops is a hard cut-off — an account
    /// three hops away scores zero no matter how many routes lead to it. A walk has no cut-off: every path
    /// contributes, longer paths contribute geometrically less, and an account reachable by twenty
    /// different four-hop routes can legitimately outrank one reachable by a single two-hop route.
    /// Restarting is what keeps it personal; without it the walk converges to global popularity and you
    /// get the same suggestions as everybody else.
    /// </para>
    /// <para>
    /// Run as truncated power iteration over the frontier rather than over the whole vector, so the cost
    /// tracks the neighbourhood actually reached and not the size of the network.
    /// </para>
    /// </summary>
    public Dictionary<int, double> PersonalizedPageRank(
        int source, double restart = 0.25, int depth = 6, int maxFrontier = 3000)
    {
        var wall = WalledFor(source);
        var totals = new Dictionary<int, double>();
        var current = new Dictionary<int, double> { [source] = 1.0 };

        for (var step = 0; step < depth && current.Count > 0; step++)
        {
            var next = new Dictionary<int, double>(current.Count * 4);

            foreach (var (node, mass) in current)
            {
                var outs = Following(node);

                if (outs.Length == 0)
                {
                    // A dangling node absorbs the walker; the restart takes it home, which costs nothing
                    // to model because the source is where the remaining mass would land anyway.
                    continue;
                }

                var share = mass * (1 - restart) / outs.Length;

                if (share < 1e-7)
                {
                    continue;
                }

                foreach (var target in outs)
                {
                    if (target == source || wall.Contains(target))
                    {
                        continue;
                    }

                    next.TryGetValue(target, out var carried);
                    next[target] = carried + share;
                }
            }

            // The tail of the frontier can never come back to matter — its mass is already below the
            // resolution of the ranking — so it is dropped rather than walked another hop.
            if (next.Count > maxFrontier)
            {
                next = next
                    .OrderByDescending(p => p.Value)
                    .Take(maxFrontier)
                    .ToDictionary(p => p.Key, p => p.Value);
            }

            foreach (var (node, mass) in next)
            {
                totals.TryGetValue(node, out var carried);
                totals[node] = carried + mass;
            }

            current = next;
        }

        totals.Remove(source);
        return totals;
    }

    /// <summary>
    /// "Popular with the people you trust", computed the way Twitter's Who-To-Follow does it: take a
    /// circle of trust — the accounts the random walk above spends most of its time on — and then run
    /// SALSA over the bipartite graph of (circle → everyone the circle follows).
    /// <para>
    /// Authority flows from a hub split across everything that hub follows, and then flows back so that a
    /// hub pointing at good authorities becomes a better hub. Two rounds are enough. What comes out is the
    /// account your circle collectively endorses most strongly per unit of attention spent — which is not
    /// the same as the account with the most followers, and not the same as the account with the most
    /// mutuals either.
    /// </para>
    /// </summary>
    /// <param name="source">The account whose circle of trust the endorsements are read from.</param>
    /// <param name="circleSize">How many accounts make up that circle.</param>
    /// <param name="rounds">Hub → authority → hub passes. Two is enough to matter and cheap.</param>
    /// <param name="maxAuthorities">Cap on the candidate set carried between rounds.</param>
    /// <param name="seed">
    /// A walk already computed for the same source. The caller normally has one, and running it twice
    /// would double the cost of a suggestion request for an identical answer.
    /// </param>
    public Dictionary<int, double> CircleAuthorities(
        int source,
        int circleSize = 50,
        int rounds = 2,
        int maxAuthorities = 2000,
        IReadOnlyDictionary<int, double>? seed = null)
    {
        var wall = WalledFor(source);

        // The circle: the people the walk trusts most, with your direct follows guaranteed a place.
        var hubs = new Dictionary<int, double>();

        foreach (var friend in Following(source))
        {
            if (!wall.Contains(friend))
            {
                hubs[friend] = 1.0 + Math.Log(1 + EdgeWeight(source, friend));
            }
        }

        var walk = seed ?? PersonalizedPageRank(source, depth: 4);

        foreach (var (node, weight) in walk.OrderByDescending(p => p.Value))
        {
            if (hubs.Count >= circleSize)
            {
                break;
            }

            if (!wall.Contains(node))
            {
                hubs.TryAdd(node, weight);
            }
        }

        if (hubs.Count == 0)
        {
            return [];
        }

        var authorities = new Dictionary<int, double>();

        for (var round = 0; round < rounds; round++)
        {
            authorities.Clear();

            // Hubs → authorities. A hub's endorsement is divided by how many accounts it follows, so
            // following everything makes each of your endorsements worth less.
            foreach (var (hub, weight) in hubs)
            {
                var outs = Following(hub);

                if (outs.Length == 0)
                {
                    continue;
                }

                var share = weight / outs.Length;

                foreach (var target in outs)
                {
                    if (target == source || wall.Contains(target))
                    {
                        continue;
                    }

                    authorities.TryGetValue(target, out var carried);
                    authorities[target] = carried + share;
                }
            }

            if (authorities.Count > maxAuthorities)
            {
                authorities = authorities
                    .OrderByDescending(p => p.Value)
                    .Take(maxAuthorities)
                    .ToDictionary(p => p.Key, p => p.Value);
            }

            if (round == rounds - 1)
            {
                break;
            }

            // Authorities → hubs, so the next round weights each hub by the quality of what it points at.
            var refreshed = new Dictionary<int, double>(hubs.Count);

            foreach (var (authority, weight) in authorities)
            {
                var backers = Followers(authority).Where(hubs.ContainsKey).ToList();

                if (backers.Count == 0)
                {
                    continue;
                }

                var share = weight / backers.Count;

                foreach (var backer in backers)
                {
                    refreshed.TryGetValue(backer, out var carried);
                    refreshed[backer] = carried + share;
                }
            }

            if (refreshed.Count == 0)
            {
                break;
            }

            hubs = refreshed;
        }

        return authorities;
    }

    // ------------------------------------------------------------------- distance

    /// <summary>
    /// How many hops from <paramref name="from"/> to <paramref name="to"/>, or -1 if there is no route.
    /// Breadth-first, so the first time a node is reached is by the shortest route — it expands in
    /// complete rings, and everything in ring k is exactly k hops away.
    /// </summary>
    public int Distance(int from, int to, int maxDepth = 4)
    {
        var path = ShortestPath(from, to, maxDepth);
        return path.Count == 0 ? -1 : path.Count - 1;
    }

    /// <summary>
    /// The actual chain of accounts connecting the two, or an empty list when no route exists inside
    /// <paramref name="maxDepth"/> hops.
    /// <para>
    /// Same breadth-first expansion as <see cref="Distance"/>, but each node records the node it was
    /// reached from. Walking those parents back from the target reconstructs the route — which is what
    /// turns "2nd degree" into "you → priya.lifts → them", an answer a person can actually check.
    /// </para>
    /// </summary>
    public List<int> ShortestPath(int from, int to, int maxDepth = 5)
    {
        if (from == to)
        {
            return [from];
        }

        if (IsWalled(from, to) || !Contains(from) || !Contains(to))
        {
            return [];
        }

        var wall = WalledFor(from);
        var parent = new Dictionary<int, int> { [from] = from };
        var frontier = new Queue<int>();
        frontier.Enqueue(from);

        for (var depth = 1; depth <= maxDepth && frontier.Count > 0; depth++)
        {
            for (var remaining = frontier.Count; remaining > 0; remaining--)
            {
                var node = frontier.Dequeue();

                foreach (var next in Following(node))
                {
                    if (wall.Contains(next) || !parent.TryAdd(next, node))
                    {
                        continue;
                    }

                    if (next == to)
                    {
                        return Rebuild(parent, from, to);
                    }

                    frontier.Enqueue(next);
                }
            }
        }

        return [];
    }

    private static List<int> Rebuild(Dictionary<int, int> parent, int from, int to)
    {
        var path = new List<int> { to };
        var cursor = to;

        while (cursor != from)
        {
            cursor = parent[cursor];
            path.Add(cursor);
        }

        path.Reverse();
        return path;
    }

    /// <summary>How many distinct accounts sit within <paramref name="hops"/> hops. Plain BFS, counted.</summary>
    public int ReachWithin(int userId, int hops)
    {
        var wall = WalledFor(userId);
        var seen = new HashSet<int> { userId };
        var frontier = new List<int> { userId };

        for (var depth = 0; depth < hops && frontier.Count > 0; depth++)
        {
            var next = new List<int>();

            foreach (var node in frontier)
            {
                foreach (var target in Following(node))
                {
                    if (!wall.Contains(target) && seen.Add(target))
                    {
                        next.Add(target);
                    }
                }
            }

            frontier = next;
        }

        return seen.Count - 1;
    }

    /// <summary>
    /// The share of your neighbours' possible connections that actually exist — the local clustering
    /// coefficient. 1.0 means everyone you follow follows each other; 0.0 means none of them do. It is the
    /// difference between a friend group and a list of strangers, and it is exactly why suggestions work
    /// well for one account and badly for another.
    /// </summary>
    public double ClusteringCoefficient(int userId, int sampleLimit = 60)
    {
        var neighbours = Following(userId).Where(id => !IsWalled(userId, id)).Take(sampleLimit).ToArray();

        if (neighbours.Length < 2)
        {
            return 0;
        }

        var linked = 0;

        for (var i = 0; i < neighbours.Length; i++)
        {
            for (var j = i + 1; j < neighbours.Length; j++)
            {
                if (IsFollowing(neighbours[i], neighbours[j]) || IsFollowing(neighbours[j], neighbours[i]))
                {
                    linked++;
                }
            }
        }

        var possible = neighbours.Length * (neighbours.Length - 1) / 2.0;
        return linked / possible;
    }

    // -------------------------------------------------------------- whole graph

    /// <summary>
    /// Global PageRank: the score an account keeps when everybody's endorsement is worth what the
    /// endorsements it received are worth. Not follower count — an account followed by ten well-connected
    /// people outranks one followed by a hundred empty accounts.
    /// <para>Used as a mild popularity prior, and as the fallback ranking for somebody with no edges yet.</para>
    /// </summary>
    public double Influence(int userId) => _pageRank.Value.GetValueOrDefault(userId, 0);

    /// <summary>Where this account sits against everybody else's influence, 0 to 1.</summary>
    public double InfluencePercentile(int userId)
    {
        var ladder = _rankLadder.Value;

        if (ladder.Length == 0)
        {
            return 0;
        }

        var score = Influence(userId);
        var below = Array.BinarySearch(ladder, score);

        if (below < 0)
        {
            below = ~below;
        }

        return (double)below / ladder.Length;
    }

    /// <summary>The most influential accounts overall — the "popular on InstaGraph" fallback, done properly.</summary>
    public List<int> MostInfluential(int limit) =>
        _pageRank.Value
            .OrderByDescending(p => p.Value)
            .Take(limit)
            .Select(p => p.Key)
            .ToList();

    private Dictionary<int, double> ComputePageRank()
    {
        const double damping = 0.85;
        const int iterations = 25;

        var n = _ids.Length;

        if (n == 0)
        {
            return [];
        }

        var rank = new Dictionary<int, double>(n);
        var next = new Dictionary<int, double>(n);

        foreach (var id in _ids)
        {
            rank[id] = 1.0 / n;
        }

        for (var step = 0; step < iterations; step++)
        {
            var dangling = 0.0;

            foreach (var id in _ids)
            {
                next[id] = 0.0;

                // An account that follows nobody would leak its rank out of the system, so what it holds
                // is collected and spread evenly instead.
                if (Following(id).Length == 0)
                {
                    dangling += rank[id];
                }
            }

            foreach (var id in _ids)
            {
                var outs = Following(id);

                if (outs.Length == 0)
                {
                    continue;
                }

                var share = rank[id] / outs.Length;

                foreach (var target in outs)
                {
                    next[target] += share;
                }
            }

            var baseline = ((1 - damping) / n) + (damping * dangling / n);

            foreach (var id in _ids)
            {
                rank[id] = baseline + (damping * next[id]);
            }
        }

        return rank;
    }

    /// <summary>Which cluster this account fell into. Two accounts sharing a label move in the same crowd.</summary>
    public int CommunityOf(int userId) => _communities.Value.GetValueOrDefault(userId, userId);

    /// <summary>How many accounts share this account's cluster.</summary>
    public int CommunitySize(int userId) => _communitySizes.Value.GetValueOrDefault(CommunityOf(userId), 1);

    public int CommunityCount => _communitySizes.Value.Count;

    /// <summary>
    /// Communities by label propagation. Every account starts as its own community, then repeatedly adopts
    /// whichever label is most common among its neighbours; dense pockets agree within a few passes and
    /// the labels stop moving.
    /// <para>
    /// No target number of clusters, no distance metric, no content — the structure of the edges alone
    /// decides where the boundaries fall. Ties break on the lower id so the same snapshot always produces
    /// the same clustering, which matters because the result is shown to people.
    /// </para>
    /// <para>Runs on the undirected projection: for grouping, who pointed at whom is not the question.</para>
    /// </summary>
    private Dictionary<int, int> ComputeCommunities()
    {
        const int passes = 12;

        var label = new Dictionary<int, int>(_ids.Length);

        foreach (var id in _ids)
        {
            label[id] = id;
        }

        var tally = new Dictionary<int, int>();

        for (var pass = 0; pass < passes; pass++)
        {
            var moved = 0;

            foreach (var id in _ids)
            {
                tally.Clear();

                foreach (var neighbour in Following(id))
                {
                    Bump(tally, label[neighbour], IsFollowing(neighbour, id) ? 2 : 1);
                }

                foreach (var neighbour in Followers(id))
                {
                    Bump(tally, label[neighbour], 1);
                }

                if (tally.Count == 0)
                {
                    continue;
                }

                var best = label[id];
                var bestCount = -1;

                foreach (var (candidate, count) in tally)
                {
                    if (count > bestCount || (count == bestCount && candidate < best))
                    {
                        best = candidate;
                        bestCount = count;
                    }
                }

                if (best != label[id])
                {
                    label[id] = best;
                    moved++;
                }
            }

            if (moved == 0)
            {
                break;
            }
        }

        return label;

        static void Bump(Dictionary<int, int> counts, int key, int by)
        {
            counts.TryGetValue(key, out var current);
            counts[key] = current + by;
        }
    }

    // ------------------------------------------------------------- ego network

    /// <summary>
    /// The slice of the graph around one account: the nodes within <paramref name="depth"/> hops and every
    /// edge that runs between them. What the network view draws.
    /// <para>
    /// Capped, and the cap is applied by relevance rather than by arbitrary truncation — direct follows
    /// first, then the second ring ordered by how many of your follows lead there. A drawing of a hundred
    /// well-chosen nodes says something; a drawing of ten thousand says nothing.
    /// </para>
    /// </summary>
    public EgoNetwork Ego(int source, int depth = 2, int maxNodes = 90)
    {
        var wall = WalledFor(source);
        var hop = new Dictionary<int, int> { [source] = 0 };

        var direct = Following(source)
            .Where(id => !wall.Contains(id))
            .OrderByDescending(id => EdgeWeight(source, id))
            .ThenByDescending(id => Followers(id).Length)
            .Take(Math.Max(1, maxNodes / 2))
            .ToList();

        foreach (var id in direct)
        {
            hop[id] = 1;
        }

        if (depth >= 2 && hop.Count < maxNodes)
        {
            // The second ring, ranked by how many routes reach it — the same evidence the suggestions use.
            var routes = new Dictionary<int, int>();

            foreach (var friend in direct)
            {
                foreach (var candidate in Following(friend))
                {
                    if (candidate == source || hop.ContainsKey(candidate) || wall.Contains(candidate))
                    {
                        continue;
                    }

                    routes.TryGetValue(candidate, out var count);
                    routes[candidate] = count + 1;
                }
            }

            foreach (var (id, _) in routes
                         .OrderByDescending(p => p.Value)
                         .ThenByDescending(p => Influence(p.Key))
                         .Take(maxNodes - hop.Count))
            {
                hop[id] = 2;
            }
        }

        var nodes = hop
            .Select(p => new EgoNode(p.Key, p.Value, CommunityOf(p.Key), Influence(p.Key)))
            .OrderBy(n => n.Hop)
            .ToList();

        var edges = new List<EgoEdge>();

        foreach (var from in hop.Keys)
        {
            foreach (var to in Following(from))
            {
                if (hop.ContainsKey(to))
                {
                    edges.Add(new EgoEdge(from, to, EdgeWeight(from, to), IsFollowing(to, from)));
                }
            }
        }

        return new EgoNetwork(nodes, edges);
    }

    /// <summary>Everything the network panel reports, all of it read straight off the edge set.</summary>
    public EgoStats Stats(int userId)
    {
        var following = Following(userId);
        var followers = Followers(userId);
        var mutual = following.Count(id => IsFollowing(id, userId));

        return new EgoStats(
            Following: following.Length,
            Followers: followers.Length,
            Mutual: mutual,
            Reach1: ReachWithin(userId, 1),
            Reach2: ReachWithin(userId, 2),
            Reach3: ReachWithin(userId, 3),
            Reciprocity: following.Length == 0 ? 0 : (double)mutual / following.Length,
            Clustering: ClusteringCoefficient(userId),
            CommunitySize: CommunitySize(userId),
            InfluencePercentile: InfluencePercentile(userId));
    }
}

/// <summary>What a two-hop walk found out about one candidate.</summary>
public sealed class TwoHopEvidence
{
    /// <summary>The Adamic–Adar sum: rare intermediaries counted for more than promiscuous ones.</summary>
    public double Score { get; set; }

    /// <summary>How many accounts you follow lead here.</summary>
    public int MutualCount { get; set; }

    /// <summary>A few of those accounts, strongest tie first — the "Followed by …" line.</summary>
    public List<int> Via { get; } = [];
}

public record EgoNode(int UserId, int Hop, int Community, double Influence);

public record EgoEdge(int From, int To, int Weight, bool Mutual);

public record EgoNetwork(IReadOnlyList<EgoNode> Nodes, IReadOnlyList<EgoEdge> Edges);

public record EgoStats(
    int Following,
    int Followers,
    int Mutual,
    int Reach1,
    int Reach2,
    int Reach3,
    double Reciprocity,
    double Clustering,
    int CommunitySize,
    double InfluencePercentile);
