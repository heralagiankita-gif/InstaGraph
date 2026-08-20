using Microsoft.AspNetCore.SignalR;

namespace InstaGraph.Api.Realtime;

/// <summary>
/// The one way anything in the app pushes something to a browser.
/// <para>
/// Services depend on this rather than on <c>IHubContext</c> directly, so nothing below the realtime
/// folder has to know that SignalR exists — and a service that pushes an event stays testable without a
/// hub. Every method is fire-and-forget from the caller's point of view: a socket that has gone away must
/// never fail the request that triggered the push.
/// </para>
/// </summary>
public interface IRealtimeNotifier
{
    /// <summary>Sends one payload to every socket a single account has open.</summary>
    Task ToUserAsync(int userId, string method, object payload, CancellationToken ct = default);

    /// <summary>Sends the same payload to several accounts at once.</summary>
    Task ToUsersAsync(IEnumerable<int> userIds, string method, object payload, CancellationToken ct = default);
}

/// <summary>The event names, in one place, so the client and the server cannot drift apart quietly.</summary>
public static class RealtimeEvents
{
    /// <summary>A message arrived in a thread you are in. Payload: { conversationId, message }.</summary>
    public const string Message = "message";

    /// <summary>An existing message changed — unsent, or its reactions moved.</summary>
    public const string MessageChanged = "messageChanged";

    /// <summary>Somebody is typing. Payload: { conversationId, userId, username }.</summary>
    public const string Typing = "typing";

    /// <summary>Somebody read up to a message. Payload: { conversationId, userId, messageId }.</summary>
    public const string Read = "read";

    /// <summary>A thread appeared, or moved between inbox, requests and spam.</summary>
    public const string Conversation = "conversation";

    /// <summary>The two numbers on the messages icon.</summary>
    public const string Counts = "counts";

    /// <summary>Somebody came online or went away. Payload: { userId, online, lastActiveAt }.</summary>
    public const string Presence = "presence";

    /// <summary>A like, comment, follow, mention or reply landed in your activity.</summary>
    public const string Notification = "notification";

    /// <summary>How many unread notifications there are now.</summary>
    public const string ActivityCount = "activityCount";

    /// <summary>Somebody you follow posted a story.</summary>
    public const string Story = "story";

    /// <summary>Somebody you follow posted a photo, so the feed can offer to refresh.</summary>
    public const string Post = "post";
}

public class RealtimeNotifier(IHubContext<RealtimeHub> hub, ILogger<RealtimeNotifier> logger)
    : IRealtimeNotifier
{
    public Task ToUserAsync(int userId, string method, object payload, CancellationToken ct = default) =>
        SendAsync(hub.Clients.Group(RealtimeHub.UserGroup(userId)), method, payload, ct);

    public Task ToUsersAsync(
        IEnumerable<int> userIds, string method, object payload, CancellationToken ct = default)
    {
        var groups = userIds.Distinct().Select(RealtimeHub.UserGroup).ToList();

        return groups.Count == 0
            ? Task.CompletedTask
            : SendAsync(hub.Clients.Groups(groups), method, payload, ct);
    }

    private async Task SendAsync(IClientProxy clients, string method, object payload, CancellationToken ct)
    {
        try
        {
            await clients.SendAsync(method, payload, ct);
        }
        catch (Exception ex)
        {
            // A push is a courtesy. Every screen that consumes one can also ask for the same thing over
            // HTTP, so a dead socket is a log line and never an error the person who acted has to see.
            logger.LogDebug(ex, "Could not push {Method} to a client.", method);
        }
    }
}
