using System.Collections.Concurrent;
using InstaGraph.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Services;

/// <summary>
/// Which tokens have stopped being valid before their expiry says so.
///
/// <para>
/// A JWT is a signed claim about the past: it says who somebody was when it was issued, and nothing
/// afterwards can reach back and change it. That is what makes it cheap, and it is also why changing a
/// password would otherwise do nothing at all to whoever already had a session — the very case the
/// change exists for. Eight hours of a stolen session surviving a password change is not a password
/// change.
/// </para>
///
/// <para>
/// So the token carries the moment it was issued, and this holds the moment each account last changed
/// its password. A token issued before that moment is refused. Nothing is stored per session, and the
/// common case — an account that has never changed its password — costs one dictionary miss.
/// </para>
///
/// <para>
/// It is seeded from the database at start-up and written to on every change from then on, which makes
/// it complete for one process. A second API instance would need this in a shared store rather than a
/// field; that is the one thing here that does not survive being scaled out.
/// </para>
/// </summary>
public interface ISessionRevocations
{
    /// <summary>True when a token issued at that moment is no longer good for this account.</summary>
    bool IsRevoked(int userId, DateTime tokenIssuedAt);

    /// <summary>Ends every session issued before <paramref name="changedAt"/>.</summary>
    void RevokeBefore(int userId, DateTime changedAt);

    /// <summary>Reads the accounts that have ever changed a password back into memory.</summary>
    Task LoadAsync(AppDbContext db, CancellationToken ct = default);
}

public class SessionRevocations(ILogger<SessionRevocations> logger) : ISessionRevocations
{
    private readonly ConcurrentDictionary<int, DateTime> changedAt = new();

    public bool IsRevoked(int userId, DateTime tokenIssuedAt) =>
        changedAt.TryGetValue(userId, out var cutoff) && tokenIssuedAt < cutoff;

    public void RevokeBefore(int userId, DateTime cutoff) =>
        changedAt.AddOrUpdate(userId, cutoff, (_, existing) => cutoff > existing ? cutoff : existing);

    public async Task LoadAsync(AppDbContext db, CancellationToken ct = default)
    {
        var rows = await db.Users
            .Where(u => u.PasswordChangedAt != null)
            .Select(u => new { u.Id, u.PasswordChangedAt })
            .ToListAsync(ct);

        foreach (var row in rows)
        {
            changedAt[row.Id] = row.PasswordChangedAt!.Value;
        }

        logger.LogInformation("Loaded {Count} password-change cut-offs.", rows.Count);
    }
}
