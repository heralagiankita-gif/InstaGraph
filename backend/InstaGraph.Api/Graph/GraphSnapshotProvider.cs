using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace InstaGraph.Api.Graph;

public interface IGraphSnapshotProvider
{
    /// <summary>The current adjacency lists, rebuilt from SQL if the cached copy has expired.</summary>
    Task<SocialGraph> GetAsync(CancellationToken ct = default);

    /// <summary>Called by every write that moves an edge, so the next read rebuilds.</summary>
    void Invalidate();
}

/// <summary>
/// Holds one shared copy of the follow graph and rebuilds it when it goes stale.
/// <para>
/// The trade is staleness: between a follow and the next rebuild, suggestions are computed against a
/// graph that is a few seconds old. Every real platform makes the same trade — nobody serves "suggested
/// for you" from a perfectly current graph — so writes call <see cref="Invalidate"/> and the snapshot
/// also expires on a timer regardless.
/// </para>
/// </summary>
public class GraphSnapshotProvider(
    IServiceScopeFactory scopeFactory,
    IOptions<FeedSettings> feedSettings,
    ILogger<GraphSnapshotProvider> logger) : IGraphSnapshotProvider
{
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly TimeSpan _ttl = TimeSpan.FromSeconds(Math.Max(1, feedSettings.Value.SnapshotCacheSeconds));

    private SocialGraph? _current;
    private DateTime _builtAt = DateTime.MinValue;

    public async Task<SocialGraph> GetAsync(CancellationToken ct = default)
    {
        if (_current is not null && DateTime.UtcNow - _builtAt < _ttl)
        {
            return _current;
        }

        await _lock.WaitAsync(ct);

        try
        {
            // Another request may have rebuilt it while this one waited for the lock.
            if (_current is not null && DateTime.UtcNow - _builtAt < _ttl)
            {
                return _current;
            }

            _current = await BuildAsync(ct);
            _builtAt = DateTime.UtcNow;

            logger.LogInformation(
                "Follow graph rebuilt: {Nodes} accounts, {Edges} follows, {Blocks} blocks.",
                _current.NodeCount, _current.EdgeCount, _current.BlockCount);

            return _current;
        }
        finally
        {
            _lock.Release();
        }
    }

    public void Invalidate() => _builtAt = DateTime.MinValue;

    private async Task<SocialGraph> BuildAsync(CancellationToken ct)
    {
        // A scope of its own: the provider is a singleton and the DbContext is scoped.
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var userIds = await db.Users
            .Where(u => u.IsActive)
            .Select(u => u.Id)
            .ToListAsync(ct);

        // Two integers and a weight per edge — the whole graph, and nothing else, in one scan.
        var edges = await db.Follows
            .Where(f => !f.IsPending)
            .Select(f => new { f.FollowerId, f.FolloweeId, f.InteractionScore })
            .ToListAsync(ct);

        // Blocks travel with the graph rather than being checked per query, because the filter has to
        // apply part-way through a traversal — at an intermediary the caller never asked about.
        var blocks = await db.Blocks
            .Select(b => new { b.BlockerId, b.BlockedId })
            .ToListAsync(ct);

        return new SocialGraph(
            userIds,
            edges.Select(e => (e.FollowerId, e.FolloweeId, e.InteractionScore)).ToList(),
            blocks.Select(b => (b.BlockerId, b.BlockedId)).ToList());
    }
}
