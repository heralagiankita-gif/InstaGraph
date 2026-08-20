using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Services;

public interface INotificationService
{
    /// <summary>
    /// Queues a notification on the tracked context. The caller saves — so the notification and the thing
    /// that caused it land in the same transaction, and you can never get "x liked your post" for a like
    /// that failed to save.
    /// </summary>
    void Add(int recipientId, int actorId, NotificationKind kind, int? postId = null);

    /// <summary>
    /// Pushes everything <see cref="Add"/> queued to whoever is holding a socket, and updates their
    /// badge. Called by the service that saved, immediately after it saved — never before, because a
    /// notification for a transaction that rolled back is worse than a slow one.
    /// </summary>
    Task PushPendingAsync(CancellationToken ct = default);

    Task RemoveAsync(int recipientId, int actorId, NotificationKind kind, int? postId, CancellationToken ct = default);

    Task<Page<NotificationResponse>> ListAsync(int userId, int page, int pageSize, CancellationToken ct = default);

    Task<int> UnreadCountAsync(int userId, CancellationToken ct = default);

    Task MarkAllReadAsync(int userId, CancellationToken ct = default);
}

public class NotificationService(AppDbContext db, IRealtimeNotifier realtime) : INotificationService
{
    /// <summary>
    /// The rows queued during this request. Held as entity references rather than ids because the ids do
    /// not exist until the caller saves.
    /// </summary>
    private readonly List<Notification> _pending = [];

    public void Add(int recipientId, int actorId, NotificationKind kind, int? postId = null)
    {
        // Liking your own photo should not notify you about it.
        if (recipientId == actorId)
        {
            return;
        }

        var notification = new Notification
        {
            RecipientId = recipientId,
            ActorId = actorId,
            Kind = kind,
            PostId = postId
        };

        db.Notifications.Add(notification);
        _pending.Add(notification);
    }

    public async Task PushPendingAsync(CancellationToken ct = default)
    {
        if (_pending.Count == 0)
        {
            return;
        }

        // Take a copy and clear first: a failed push must not queue the same notification up to be sent
        // again by the next save in the same request.
        var pending = _pending.ToList();
        _pending.Clear();

        var ids = pending.Where(n => n.Id > 0).Select(n => n.Id).ToList();

        if (ids.Count == 0)
        {
            return;
        }

        var saved = await db.Notifications
            .AsNoTracking()
            .Include(n => n.Actor)
            .Include(n => n.Post)
            .Where(n => ids.Contains(n.Id))
            .ToListAsync(ct);

        foreach (var group in saved.GroupBy(n => n.RecipientId))
        {
            foreach (var notification in group)
            {
                await realtime.ToUserAsync(
                    group.Key, RealtimeEvents.Notification, notification.ToResponse(), ct);
            }

            var unread = await UnreadCountAsync(group.Key, ct);

            await realtime.ToUserAsync(group.Key, RealtimeEvents.ActivityCount, unread, ct);
        }
    }

    public async Task RemoveAsync(
        int recipientId, int actorId, NotificationKind kind, int? postId, CancellationToken ct = default)
    {
        // Unliking takes the notification back with it, so the list does not fill with things that are no
        // longer true.
        var existing = await db.Notifications
            .Where(n => n.RecipientId == recipientId
                        && n.ActorId == actorId
                        && n.Kind == kind
                        && n.PostId == postId)
            .ToListAsync(ct);

        if (existing.Count > 0)
        {
            db.Notifications.RemoveRange(existing);
        }
    }

    public async Task<Page<NotificationResponse>> ListAsync(
        int userId, int page, int pageSize, CancellationToken ct = default)
    {
        var query = db.Notifications
            .AsNoTracking()
            .Include(n => n.Actor)
            .Include(n => n.Post)
            .Where(n => n.RecipientId == userId)
            .OrderByDescending(n => n.CreatedAt);

        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .ToListAsync(ct);

        var hasMore = items.Count > pageSize;

        return new Page<NotificationResponse>
        {
            Items = items.Take(pageSize).Select(n => n.ToResponse()).ToList(),
            PageNumber = page,
            PageSize = pageSize,
            HasMore = hasMore
        };
    }

    public Task<int> UnreadCountAsync(int userId, CancellationToken ct = default) =>
        db.Notifications.CountAsync(n => n.RecipientId == userId && !n.IsRead, ct);

    public async Task MarkAllReadAsync(int userId, CancellationToken ct = default)
    {
        await db.Notifications
            .Where(n => n.RecipientId == userId && !n.IsRead)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true), ct);

        await realtime.ToUserAsync(userId, RealtimeEvents.ActivityCount, 0, ct);
    }
}
