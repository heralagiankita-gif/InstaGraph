using System.Security.Claims;
using InstaGraph.Api.Data;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Realtime;

/// <summary>
/// The socket. One connection per open tab, authenticated with the same JWT every other call uses.
/// <para>
/// There are no per-conversation groups. Every account joins exactly one group — its own — and the server
/// addresses people rather than rooms. That costs one extra send per member of a group chat and buys two
/// things worth more than that: a payload can be tailored to the person receiving it, so "is this mine"
/// and "did I react to this" are answered on the server instead of guessed at in the browser; and there
/// is no membership bookkeeping to get wrong, which is where socket code usually leaks.
/// </para>
/// <para>
/// The hub itself does almost nothing. It tracks presence and forwards typing. Everything else is pushed
/// by the services that already own the rules, through <see cref="IRealtimeNotifier"/>.
/// </para>
/// </summary>
[Authorize]
public class RealtimeHub(
    IPresenceTracker presence,
    IServiceScopeFactory scopeFactory,
    ILogger<RealtimeHub> logger) : Hub
{
    public static string UserGroup(int userId) => $"u:{userId}";

    private int? CurrentUserId =>
        int.TryParse(Context.User?.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    public override async Task OnConnectedAsync()
    {
        var userId = CurrentUserId;

        if (userId is null)
        {
            Context.Abort();
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, UserGroup(userId.Value));

        // Only the first socket is news. Opening a second tab must not announce anybody twice.
        if (presence.Connected(userId.Value, Context.ConnectionId))
        {
            await BroadcastPresenceAsync(userId.Value, online: true);
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (presence.Disconnected(Context.ConnectionId, out var userId))
        {
            await BroadcastPresenceAsync(userId, online: false);
            await PersistLastSeenAsync(userId);
        }

        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>
    /// Says the caller is typing in a thread. Checked against membership every time — a socket message is
    /// as much an untrusted request as an HTTP one, and this is the only thing a client can push.
    /// </summary>
    public async Task Typing(int conversationId)
    {
        var userId = CurrentUserId;
        if (userId is null) return;

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var member = await db.ConversationMembers
            .AsNoTracking()
            .FirstOrDefaultAsync(m =>
                m.ConversationId == conversationId && m.UserId == userId.Value && m.LeftAt == null);

        if (member is null)
        {
            return;
        }

        presence.SetTyping(conversationId, userId.Value);

        var username = Context.User?.Identity?.Name
                       ?? await db.Users.Where(u => u.Id == userId).Select(u => u.Username).FirstAsync();

        var others = await db.ConversationMembers
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId && m.UserId != userId.Value && m.LeftAt == null)
            .Select(m => m.UserId)
            .ToListAsync();

        var notifier = scope.ServiceProvider.GetRequiredService<IRealtimeNotifier>();

        await notifier.ToUsersAsync(
            others,
            RealtimeEvents.Typing,
            new { conversationId, userId = userId.Value, username });
    }

    /// <summary>
    /// Tells the people who would care that somebody arrived or left.
    /// <para>
    /// "Would care" is answered from the graph rather than broadcast to everybody: the accounts you share
    /// a thread with, plus the accounts you follow who follow you back. Presence is also symmetric — an
    /// account with activity status switched off is announced to nobody and hears about nobody, so the
    /// setting cannot become a one-way mirror.
    /// </para>
    /// </summary>
    private async Task BroadcastPresenceAsync(int userId, bool online)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var me = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);

            if (me is null || !me.ShowActivityStatus)
            {
                return;
            }

            var threadIds = await db.ConversationMembers
                .AsNoTracking()
                .Where(m => m.UserId == userId && m.State == MemberState.Accepted && m.LeftAt == null)
                .Select(m => m.ConversationId)
                .ToListAsync();

            var partners = await db.ConversationMembers
                .AsNoTracking()
                .Where(m => threadIds.Contains(m.ConversationId) && m.UserId != userId && m.LeftAt == null)
                .Select(m => m.UserId)
                .Distinct()
                .ToListAsync();

            // Anyone who has switched their own status off does not get told about other people either.
            var audience = await db.Users
                .AsNoTracking()
                .Where(u => partners.Contains(u.Id) && u.ShowActivityStatus)
                .Select(u => u.Id)
                .ToListAsync();

            if (audience.Count == 0)
            {
                return;
            }

            var notifier = scope.ServiceProvider.GetRequiredService<IRealtimeNotifier>();

            await notifier.ToUsersAsync(
                audience,
                RealtimeEvents.Presence,
                new { userId, online, lastActiveAt = DateTime.UtcNow });
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Could not broadcast presence for {UserId}.", userId);
        }
    }

    /// <summary>
    /// Writes the durable last-seen when the final socket closes. In-memory presence answers "active
    /// now"; this column only exists so "active 3 h ago" survives a restart.
    /// </summary>
    private async Task PersistLastSeenAsync(int userId)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            await db.Users
                .Where(u => u.Id == userId)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.LastActiveAt, DateTime.UtcNow));
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Could not persist last-seen for {UserId}.", userId);
        }
    }
}
