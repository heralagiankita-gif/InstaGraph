namespace InstaGraph.Api.DTOs;

/// <summary>
/// The route between two accounts, reconstructed from the breadth-first search.
/// <para>
/// "2nd degree" on its own is a claim. The chain of accounts that produced it is the evidence, and it is
/// the difference between a number the app asserts and one a person can check.
/// </para>
/// </summary>
public record ConnectionPathResponse
{
    public bool Connected { get; init; }

    /// <summary>How many hops, or -1 when nothing links the two inside the search depth.</summary>
    public int Degrees { get; init; }

    /// <summary>The accounts along the route, starting with you and ending with them.</summary>
    public IReadOnlyList<UserSummary> Path { get; init; } = [];

    /// <summary>e.g. "2nd degree — through priya.lifts".</summary>
    public string Summary { get; init; } = string.Empty;

    /// <summary>People you follow who also follow them.</summary>
    public int MutualCount { get; init; }

    public bool FollowsYou { get; init; }

    public bool IsFollowing { get; init; }

    /// <summary>True when both of you were placed in the same cluster by label propagation.</summary>
    public bool SameCommunity { get; init; }

    /// <summary>How much of what you each follow overlaps, 0 to 1.</summary>
    public double Similarity { get; init; }
}

/// <summary>One account in the network drawing.</summary>
public record NetworkNode : UserSummary
{
    /// <summary>0 is you, 1 is somebody you follow, 2 is somebody they follow.</summary>
    public int Hop { get; init; }

    /// <summary>Label-propagation cluster id. Only meaningful compared with another node's.</summary>
    public int Community { get; init; }

    /// <summary>Global PageRank, normalised against the largest node in this drawing.</summary>
    public double Influence { get; init; }

    public int FollowerCount { get; init; }

    public bool IsYou { get; init; }

    public bool IsFollowing { get; init; }

    public bool FollowsYou { get; init; }
}

/// <summary>One directed edge in the network drawing.</summary>
public record NetworkEdge
{
    public int Source { get; init; }

    public int Target { get; init; }

    /// <summary>Interaction score on the edge — how much has actually passed between the two.</summary>
    public int Weight { get; init; }

    /// <summary>True when the edge runs both ways.</summary>
    public bool Mutual { get; init; }
}

public record NetworkResponse
{
    public IReadOnlyList<NetworkNode> Nodes { get; init; } = [];

    public IReadOnlyList<NetworkEdge> Edges { get; init; } = [];

    /// <summary>How many clusters the drawn slice falls into.</summary>
    public int CommunityCount { get; init; }

    /// <summary>True when the drawing had to be capped — the real neighbourhood is larger.</summary>
    public bool Truncated { get; init; }
}

/// <summary>Everything the network panel reports about one account's position in the graph.</summary>
public record NetworkStatsResponse
{
    public int Following { get; init; }

    public int Followers { get; init; }

    /// <summary>Edges that run both ways — the closest thing this graph has to friendship.</summary>
    public int Mutual { get; init; }

    public int Reach1 { get; init; }

    public int Reach2 { get; init; }

    public int Reach3 { get; init; }

    /// <summary>Share of your follows who follow you back, 0 to 1.</summary>
    public double Reciprocity { get; init; }

    /// <summary>How densely your neighbours are connected to each other, 0 to 1.</summary>
    public double Clustering { get; init; }

    public int CommunitySize { get; init; }

    /// <summary>Where your PageRank sits against everybody else's, 0 to 1.</summary>
    public double InfluencePercentile { get; init; }

    // The graph as a whole, for context.
    public int GraphNodes { get; init; }

    public int GraphEdges { get; init; }

    public int GraphCommunities { get; init; }

    /// <summary>Content hash of the snapshot. Poll <c>GET /api/graph/version</c> to watch it cheaply.</summary>
    public string GraphVersion { get; init; } = string.Empty;

    public DateTime SnapshotBuiltAt { get; init; }
}

/// <summary>
/// The cheapest question the graph answers: has it changed?
/// <para>
/// Nothing here forces a whole-graph pass — no PageRank, no clustering — so a client can poll this on a
/// short interval and only fetch the picture on the rare tick where the fingerprint actually moves.
/// </para>
/// </summary>
public record GraphVersionResponse
{
    /// <summary>Content hash of the edge set. Changes only when the graph really differs.</summary>
    public string Version { get; init; } = string.Empty;

    public int Nodes { get; init; }

    public int Edges { get; init; }

    public int Blocks { get; init; }

    /// <summary>When this snapshot was built. Moves on every cache rebuild, so do not use it to detect change.</summary>
    public DateTime BuiltAt { get; init; }
}
