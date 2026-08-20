using System.Collections.Concurrent;

namespace InstaGraph.Api.Services;

public interface IPresenceTracker
{
    /// <summary>Marks somebody as around. Called once per authenticated request.</summary>
    void Touch(int userId);

    /// <summary>
    /// A socket opened. Returns true if this is the account's <em>first</em> one, which is the moment
    /// worth telling anybody about.
    /// </summary>
    bool Connected(int userId, string connectionId);

    /// <summary>
    /// A socket closed. Returns true if it was the last one, so the account has genuinely gone.
    /// </summary>
    bool Disconnected(string connectionId, out int userId);

    /// <summary>Active inside the presence window, or holding an open socket right now.</summary>
    bool IsOnline(int userId);

    /// <summary>When they were last seen, or null if this process has not seen them at all.</summary>
    DateTime? LastSeen(int userId);

    /// <summary>Says somebody is typing in a thread. Expires on its own a few seconds later.</summary>
    void SetTyping(int conversationId, int userId);

    /// <summary>Everybody currently typing in a thread, except the person asking.</summary>
    IReadOnlyList<int> TypingIn(int conversationId, int exceptUserId);
}

/// <summary>
/// Who is around, and who is typing — held in memory and nowhere else.
/// <para>
/// Both facts are worthless the moment they are a minute old, so writing them to SQL would mean a row
/// update on every keystroke to store something that expires before the next page load. A dictionary in
/// the process is the right shape for state whose whole value is that it is current.
/// </para>
/// <para>
/// Sockets are counted rather than flagged: somebody with the app open in three tabs is online once, and
/// closing two of them does not put them offline. Only the first connection and the last disconnection
/// are worth broadcasting, which is what the two <c>bool</c> returns are for.
/// </para>
/// <para>
/// The honest cost: it lives in one process, so it does not survive a restart and would need Redis or a
/// SignalR backplane behind more than one instance. For a single API that is the correct trade, and the
/// UI is built so that a missing presence reads as "not shown" rather than as "offline".
/// </para>
/// </summary>
public class PresenceTracker : IPresenceTracker
{
    /// <summary>How long after a request somebody still counts as online without a socket.</summary>
    private static readonly TimeSpan OnlineWindow = TimeSpan.FromSeconds(70);

    /// <summary>A typing indicator with nothing renewing it fades after this.</summary>
    private static readonly TimeSpan TypingWindow = TimeSpan.FromSeconds(6);

    private readonly ConcurrentDictionary<int, DateTime> _lastSeen = new();

    /// <summary>connection id → who owns it.</summary>
    private readonly ConcurrentDictionary<string, int> _connections = new();

    /// <summary>user → how many sockets they currently hold.</summary>
    private readonly ConcurrentDictionary<int, int> _sockets = new();

    /// <summary>(conversation, user) → when they last said they were typing.</summary>
    private readonly ConcurrentDictionary<(int Conversation, int User), DateTime> _typing = new();

    public void Touch(int userId) => _lastSeen[userId] = DateTime.UtcNow;

    public bool Connected(int userId, string connectionId)
    {
        _connections[connectionId] = userId;
        _lastSeen[userId] = DateTime.UtcNow;

        var count = _sockets.AddOrUpdate(userId, 1, (_, current) => current + 1);

        return count == 1;
    }

    public bool Disconnected(string connectionId, out int userId)
    {
        if (!_connections.TryRemove(connectionId, out userId))
        {
            return false;
        }

        _lastSeen[userId] = DateTime.UtcNow;

        var remaining = _sockets.AddOrUpdate(userId, 0, (_, current) => Math.Max(0, current - 1));

        if (remaining > 0)
        {
            return false;
        }

        _sockets.TryRemove(userId, out _);

        return true;
    }

    public bool IsOnline(int userId) =>
        _sockets.ContainsKey(userId)
        || (_lastSeen.TryGetValue(userId, out var seen) && DateTime.UtcNow - seen < OnlineWindow);

    public DateTime? LastSeen(int userId) => _lastSeen.TryGetValue(userId, out var seen) ? seen : null;

    public void SetTyping(int conversationId, int userId) =>
        _typing[(conversationId, userId)] = DateTime.UtcNow;

    public IReadOnlyList<int> TypingIn(int conversationId, int exceptUserId)
    {
        var now = DateTime.UtcNow;
        var typing = new List<int>();

        foreach (var (key, at) in _typing)
        {
            if (now - at > TypingWindow)
            {
                // Swept on read: there is no background timer, and the map only ever holds as many
                // entries as there are open threads.
                _typing.TryRemove(key, out _);
                continue;
            }

            if (key.Conversation == conversationId && key.User != exceptUserId)
            {
                typing.Add(key.User);
            }
        }

        return typing;
    }
}
