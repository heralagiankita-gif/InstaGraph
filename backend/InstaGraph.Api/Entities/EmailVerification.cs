namespace InstaGraph.Api.Entities;

/// <summary>
/// What a code was issued for.
///
/// <para>
/// The two flows are the same mechanism pointed at different ends of an account's life — prove you can
/// read this address, then spend the proof — so they share a table rather than duplicating the
/// expiry, the attempt ceiling and the resend cooldown. They must not share a <em>row</em>, though: a
/// code sent to reset a password should never satisfy a sign-up, and this column is what stops one
/// being redeemed as the other.
/// </para>
/// </summary>
public enum VerificationPurpose
{
    /// <summary>Confirming an address that does not have an account yet.</summary>
    SignUp = 0,

    /// <summary>Proving control of the address on an account that already exists.</summary>
    PasswordReset = 1
}

/// <summary>
/// A six-digit code sent to an email address, and the proof that somebody typed it back.
///
/// <para>
/// The row exists before the account does. That ordering is the whole point of the flow: an address is
/// proven to belong to whoever is signing up <em>before</em> a <see cref="User"/> row is written, so the
/// database never holds an account whose email was never confirmed.
/// </para>
///
/// <para>
/// The code itself is never stored. Only a hash of it is, for the same reason a password is hashed —
/// read access to this table should not let anybody complete somebody else's sign-up. What comes back
/// out on success is <see cref="VerificationToken"/>, a single-use random string the register call has
/// to present.
/// </para>
/// </summary>
public class EmailVerification
{
    public int Id { get; set; }

    /// <summary>Lower-cased and trimmed, so a lookup is an exact match.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// Sign-up or password reset. Part of every lookup, so the two flows cannot redeem each other's codes.
    /// </summary>
    public VerificationPurpose Purpose { get; set; } = VerificationPurpose.SignUp;

    public string CodeHash { get; set; } = string.Empty;

    /// <summary>Handed out once the code is accepted, and consumed by register. Null until then.</summary>
    public string? VerificationToken { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>When the code stops working. Short, because a code that lives for a day is not a factor.</summary>
    public DateTime ExpiresAt { get; set; }

    /// <summary>
    /// Wrong guesses so far. A six-digit code is only 10^6 wide, so it needs a ceiling or it is a
    /// number somebody can simply try their way through.
    /// </summary>
    public int Attempts { get; set; }

    /// <summary>How many times a code has been sent to this address in this attempt. Rate-limits resends.</summary>
    public int Sends { get; set; } = 1;

    /// <summary>Set when the token is spent by register. A consumed row can never be replayed.</summary>
    public DateTime? ConsumedAt { get; set; }

    /// <summary>Set when the code is accepted. Until then the token is null.</summary>
    public DateTime? VerifiedAt { get; set; }
}
