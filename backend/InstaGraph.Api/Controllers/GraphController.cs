using InstaGraph.Api.Common;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Graph;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace InstaGraph.Api.Controllers;

/// <summary>
/// The graph itself, exposed directly. Every endpoint here answers a question about nodes and edges and
/// nothing else — no content is read to produce any of these results.
/// </summary>
[Route("api/graph")]
public class GraphController(IGraphInsightsService graph, ICurrentUser currentUser)
    : ApiControllerBase(currentUser)
{
    /// <summary>
    /// Ranked suggestions with the whole derivation attached — which signals fired, how strongly, and
    /// through whom.
    /// </summary>
    /// <param name="limit">How many rows to return.</param>
    /// <param name="category">
    /// Optional filter: FollowsYou, MutualFriends, PopularInCircle, ExtendedNetwork, SameCommunity or
    /// Popular. Omit for the blended list.
    /// </param>
    /// <param name="ct">Cancellation token.</param>
    [HttpGet("suggestions")]
    public async Task<ActionResult<IReadOnlyList<SuggestedUser>>> Suggestions(
        [FromQuery] int limit = 10,
        [FromQuery] string? category = null,
        CancellationToken ct = default)
    {
        SuggestionCategory? filter = null;

        if (!string.IsNullOrWhiteSpace(category) && !category.Equals("all", StringComparison.OrdinalIgnoreCase))
        {
            if (!Enum.TryParse<SuggestionCategory>(category, ignoreCase: true, out var parsed))
            {
                throw AppException.BadRequest($"'{category}' is not a suggestion category.");
            }

            filter = parsed;
        }

        return Ok(await graph.SuggestionsAsync(UserId, Math.Clamp(limit, 1, 50), filter, ct));
    }

    /// <summary>
    /// The shortest route from you to another account, with the accounts in between named. Breadth-first,
    /// capped at five hops.
    /// </summary>
    [HttpGet("path/{username}")]
    public async Task<ActionResult<ConnectionPathResponse>> Path(string username, CancellationToken ct) =>
        Ok(await graph.PathAsync(UserId, username, ct));

    /// <summary>
    /// Your neighbourhood as nodes and edges, ready to draw. Capped by relevance rather than truncated.
    /// </summary>
    /// <param name="depth">1 for your follows only, 2 to include theirs. 3 is allowed and gets crowded.</param>
    /// <param name="limit">Maximum nodes to return.</param>
    /// <param name="ct">Cancellation token.</param>
    [HttpGet("network")]
    public async Task<ActionResult<NetworkResponse>> Network(
        [FromQuery] int depth = 2, [FromQuery] int limit = 90, CancellationToken ct = default) =>
        Ok(await graph.NetworkAsync(UserId, depth, limit, ct));

    /// <summary>
    /// A content fingerprint of the current snapshot, with its node and edge counts.
    /// <para>
    /// Cheap enough to poll: it forces none of the lazy whole-graph passes. A client watches this on a short
    /// interval and only refetches the graph on the tick where the hash actually moves, which is what lets a
    /// drawing stay current without re-downloading it every few seconds.
    /// </para>
    /// </summary>
    [HttpGet("version")]
    public async Task<ActionResult<GraphVersionResponse>> Version(CancellationToken ct) =>
        Ok(await graph.VersionAsync(ct));

    /// <summary>Where you sit in the graph: reach, reciprocity, clustering, community and influence.</summary>
    [HttpGet("stats")]
    public async Task<ActionResult<NetworkStatsResponse>> Stats(CancellationToken ct) =>
        Ok(await graph.StatsAsync(UserId, ct));

    /// <summary>Everyone you follow who also follows them — the full list behind the "Followed by …" line.</summary>
    [HttpGet("mutuals/{username}")]
    public async Task<ActionResult<Page<UserRelation>>> Mutuals(
        string username,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 20, 50);
        return Ok(await graph.MutualsAsync(UserId, username, p, size, ct));
    }
}
