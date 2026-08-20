using System.Collections.Concurrent;

namespace InstaGraph.Api.Services;

/// <summary>
/// How many times a sign-in may be got wrong before the app stops answering.
///
/// <para>
/// Without this, the login endpoint is an oracle: a password is only as strong as the number of guesses
/// somebody is allowed, and "unlimited" makes the strength rule at sign-up decorative. BCrypt makes each
/// guess slow, which is not the same as making them few.
/// </para>
///
/// <para>
/// Two keys are counted rather than one, because either alone has a hole in it. Counting only the
/// account lets one machine work through a list of accounts unimpeded; counting only the address lets a
/// botnet spread the guessing at one account across many addresses. A request has to clear both.
/// </para>
///
/// <para>
/// It is deliberately in memory. The failures it counts expire in minutes, so writing them to SQL would
/// cost a row per wrong password to store something that is about to be thrown away — the same reasoning
/// as <see cref="PresenceTracker"/>. Restarting the API forgives everybody, which is the right trade for
/// a lockout that is a speed bump rather than a security boundary.
/// </para>
/// </summary>
public interface ILoginThrottle
{
    /// <summary>
    /// Null when the attempt may go ahead. Otherwise how long is left on the lock, so the caller can say
    /// so rather than repeating "wrong password" at somebody who is no longer being checked.
    /// </summary>
    TimeSpan? RetryAfter(string account, string? ipAddress);

    /// <summary>Records a wrong password and returns how long the caller is now locked out for, if at all.</summary>
    TimeSpan? Fail(string account, string? ipAddress);

    /// <summary>A correct password forgives everything counted against that account.</summary>
    void Succeed(string account, string? ipAddress);
}

public class LoginThrottle(ILogger<LoginThrottle> logger) : ILoginThrottle
{
    /// <summary>Failures older than this stop counting, so a slow trickle never accumulates into a ban.</summary>
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(30);

    /// <summary>
    /// Escalating rather than flat. Five wrong passwords is a person who has forgotten which one they
    /// used; twenty is not, and the response should cost more each time it happens.
    /// </summary>
    private static readonly (int Failures, TimeSpan Lock)[] Ladder =
    [
        (20, TimeSpan.FromMinutes(60)),
        (15, TimeSpan.FromMinutes(15)),
        (10, TimeSpan.FromMinutes(5)),
        (5, TimeSpan.FromMinutes(1))
    ];

    private sealed class Counter
    {
        public int Failures;
        public DateTime LastFailureAt;
        public DateTime? LockedUntil;
    }

    private readonly ConcurrentDictionary<string, Counter> counters = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Swept lazily rather than on a timer: nothing here matters enough to wake a thread for.</summary>
    private DateTime nextSweep = DateTime.UtcNow.Add(Window);

    public TimeSpan? RetryAfter(string account, string? ipAddress)
    {
        var now = DateTime.UtcNow;
        Sweep(now);

        TimeSpan? longest = null;

        foreach (var key in Keys(account, ipAddress))
        {
            if (!counters.TryGetValue(key, out var counter) || counter.LockedUntil is not { } until)
            {
                continue;
            }

            if (until <= now)
            {
                // The lock has run out. The failures behind it stay counted until the window expires, so
                // the next wrong password lands on the next rung of the ladder rather than the first.
                counter.LockedUntil = null;
                continue;
            }

            var left = until - now;
            if (longest is null || left > longest) longest = left;
        }

        return longest;
    }

    public TimeSpan? Fail(string account, string? ipAddress)
    {
        var now = DateTime.UtcNow;
        TimeSpan? longest = null;

        foreach (var key in Keys(account, ipAddress))
        {
            var counter = counters.GetOrAdd(key, _ => new Counter());

            lock (counter)
            {
                // A gap longer than the window means the earlier failures were somebody else, or the same
                // person on a different day. Either way they should not count towards this lockout.
                if (now - counter.LastFailureAt > Window)
                {
                    counter.Failures = 0;
                }

                counter.Failures++;
                counter.LastFailureAt = now;

                var rung = Ladder.FirstOrDefault(step => counter.Failures >= step.Failures);

                if (rung.Lock > TimeSpan.Zero)
                {
                    var until = now.Add(rung.Lock);

                    // Never shorten a lock that is already running.
                    if (counter.LockedUntil is null || until > counter.LockedUntil)
                    {
                        counter.LockedUntil = until;
                    }

                    var left = counter.LockedUntil.Value - now;
                    if (longest is null || left > longest) longest = left;
                }
            }
        }

        if (longest is not null)
        {
            logger.LogWarning(
                "Sign-in locked for {Account} for {Seconds}s after repeated failures.",
                account, (int)longest.Value.TotalSeconds);
        }

        return longest;
    }

    public void Succeed(string account, string? ipAddress)
    {
        foreach (var key in Keys(account, ipAddress))
        {
            counters.TryRemove(key, out _);
        }
    }

    /// <summary>
    /// The account key and the address key. Prefixed so an address can never collide with a username that
    /// happens to look like one.
    /// </summary>
    private static IEnumerable<string> Keys(string account, string? ipAddress)
    {
        yield return "u:" + account.Trim().ToLowerInvariant();

        if (!string.IsNullOrWhiteSpace(ipAddress))
        {
            yield return "ip:" + ipAddress;
        }
    }

    private void Sweep(DateTime now)
    {
        if (now < nextSweep)
        {
            return;
        }

        nextSweep = now.Add(Window);

        foreach (var (key, counter) in counters)
        {
            var idle = now - counter.LastFailureAt > Window;
            var unlocked = counter.LockedUntil is null || counter.LockedUntil <= now;

            if (idle && unlocked)
            {
                counters.TryRemove(key, out _);
            }
        }
    }
}
