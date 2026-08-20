using System.Security.Claims;
using InstaGraph.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Middleware;

/// <summary>
/// Marks whoever is making the request as around.
/// <para>
/// It sits after authentication and touches an in-memory dictionary, which costs nothing. The database
/// column behind it is only written every few minutes: "active now" is answered from memory, and the
/// stored value exists purely so that "active 3 h ago" survives a restart.
/// </para>
/// </summary>
public class PresenceMiddleware(RequestDelegate next)
{
    /// <summary>How rarely the durable copy of last-seen is written.</summary>
    private static readonly TimeSpan PersistEvery = TimeSpan.FromMinutes(5);

    public async Task InvokeAsync(HttpContext context, IPresenceTracker presence)
    {
        var raw = context.User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (int.TryParse(raw, out var userId))
        {
            var lastSeen = presence.LastSeen(userId);
            presence.Touch(userId);

            if (lastSeen is null || DateTime.UtcNow - lastSeen > PersistEvery)
            {
                // Deliberately fire-and-forget against a scoped context of its own: a presence write must
                // never delay, or fail, the request the person actually made.
                var scopeFactory = context.RequestServices.GetRequiredService<IServiceScopeFactory>();
                _ = PersistAsync(scopeFactory, userId);
            }
        }

        await next(context);
    }

    private static async Task PersistAsync(IServiceScopeFactory scopeFactory, int userId)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<Data.AppDbContext>();

            await db.Users
                .Where(u => u.Id == userId)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.LastActiveAt, DateTime.UtcNow));
        }
        catch
        {
            // Nothing depends on this succeeding.
        }
    }
}
