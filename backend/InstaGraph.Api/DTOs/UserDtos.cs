using System.ComponentModel.DataAnnotations;
using InstaGraph.Api.Common;

namespace InstaGraph.Api.DTOs;

/// <summary>Step one: prove you can read the address you are signing up with.</summary>
public record SendCodeRequest
{
    [Required, EmailAddress, StringLength(160)]
    public string Email { get; init; } = string.Empty;
}

public record SendCodeResponse
{
    /// <summary>Echoed back so the confirmation screen can say where it went.</summary>
    public string Email { get; init; } = string.Empty;

    public DateTime ExpiresAt { get; init; }

    /// <summary>How soon another code may be asked for.</summary>
    public int ResendInSeconds { get; init; }

    /// <summary>
    /// False when no SMTP server is configured, which means the code was written to the API log rather
    /// than sent. The sign-up screen says so instead of leaving somebody waiting on an inbox.
    /// </summary>
    public bool Delivered { get; init; }

    /// <summary>
    /// The code itself, and only ever when <see cref="Delivered"/> is false and the API is running in
    /// Development. It is the difference between a demo somebody can actually complete and one that
    /// dead-ends on a screen asking for a number nobody can see.
    /// </summary>
    public string? DevCode { get; init; }
}

/// <summary>Step two: the six digits.</summary>
public record VerifyCodeRequest
{
    [Required, EmailAddress, StringLength(160)]
    public string Email { get; init; } = string.Empty;

    [Required]
    [RegularExpression("^[0-9]{6}$", ErrorMessage = "The confirmation code is six digits.")]
    public string Code { get; init; } = string.Empty;
}

public record VerifyCodeResponse
{
    /// <summary>Single-use proof, presented to register. Not a session — it cannot do anything else.</summary>
    public string VerificationToken { get; init; } = string.Empty;

    public DateTime ExpiresAt { get; init; }
}

/// <summary>Whether a username is free, asked while somebody is still typing it.</summary>
public record UsernameAvailability
{
    public string Username { get; init; } = string.Empty;
    public bool Available { get; init; }

    /// <summary>Why not, when it is not — malformed, reserved, or taken.</summary>
    public string? Reason { get; init; }

    /// <summary>Free variations on a taken name, the way the real sign-up offers them.</summary>
    public string[] Suggestions { get; init; } = [];
}

public record RegisterRequest
{
    [Required, StringLength(30, MinimumLength = 3)]
    [RegularExpression("^[a-z0-9._]+$", ErrorMessage = "Usernames use lower-case letters, numbers, dots and underscores.")]
    public string Username { get; init; } = string.Empty;

    [Required, EmailAddress, StringLength(160)]
    public string Email { get; init; } = string.Empty;

    // The floor lives in PasswordPolicy so the annotation and the check behind it cannot drift. It used
    // to say six here while the service refused anything under eight, which produced the worst kind of
    // error message: one that contradicts the rule it is enforcing.
    [Required, StringLength(PasswordPolicy.MaximumLength, MinimumLength = PasswordPolicy.MinimumLength,
        ErrorMessage = "Your password needs at least 8 characters.")]
    public string Password { get; init; } = string.Empty;

    [Required(ErrorMessage = "Tell us your name."), StringLength(80, MinimumLength = 1)]
    public string FullName { get; init; } = string.Empty;

    /// <summary>
    /// Required, and checked against a minimum age on the server. A date of birth collected by the
    /// browser and never looked at again is theatre.
    /// </summary>
    [Required(ErrorMessage = "Enter your date of birth.")]
    public DateOnly? DateOfBirth { get; init; }

    /// <summary>What <c>POST /auth/signup/verify</c> handed back. Without it there is no account.</summary>
    [Required(ErrorMessage = "Confirm your email address first.")]
    public string VerificationToken { get; init; } = string.Empty;
}

/// <summary>
/// What register returns now: a name, not a session.
///
/// <para>
/// Signing somebody straight in after creating the account is one round trip shorter, and it is also
/// the moment they are least likely to remember what they just typed. Sending them to the login screen
/// with the username filled in means the first thing a new account does is prove it knows its own
/// password.
/// </para>
/// </summary>
public record RegisteredResponse
{
    public string Username { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
}

public record LoginRequest
{
    /// <summary>Username or email — Instagram accepts either, so this does too.</summary>
    [Required]
    public string Login { get; init; } = string.Empty;

    [Required]
    public string Password { get; init; } = string.Empty;
}

public record AuthResponse
{
    public string Token { get; init; } = string.Empty;
    public DateTime ExpiresAt { get; init; }
    public UserSummary User { get; init; } = new();
}

/// <summary>The small shape used everywhere a person appears in a list.</summary>
public record UserSummary
{
    public int Id { get; init; }
    public string Username { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string? AvatarUrl { get; init; }
    public bool IsPrivate { get; init; }

    /// <summary>The blue tick, drawn next to the username wherever one appears.</summary>
    public bool IsVerified { get; init; }
}

/// <summary>
/// A person in a list, plus how the viewer stands with them — everything a follow button needs to pick
/// its own state without a second request.
/// <para>
/// A follow is a directed edge, so "are we connected" has four answers, not two: neither of us follows
/// the other, I follow them, they follow me, or the edge runs both ways. A button that only knows about
/// the first two will tell somebody to follow an account they are already friends with, which is exactly
/// what happens when a list row carries nothing but a username.
/// </para>
/// </summary>
public record UserRelation : UserSummary
{
    public bool IsMe { get; init; }

    /// <summary>There is an accepted edge from the viewer to this account.</summary>
    public bool IsFollowing { get; init; }

    /// <summary>The viewer's request to a private account is still waiting.</summary>
    public bool FollowRequested { get; init; }

    /// <summary>There is an accepted edge from this account to the viewer.</summary>
    public bool FollowsYou { get; init; }

    /// <summary>They have a request waiting on the viewer's own private account.</summary>
    public bool RequestedYou { get; init; }

    /// <summary>Both edges exist. The cycle is closed, and the app calls that a friend.</summary>
    public bool IsFriend { get; init; }
}

public record ProfileResponse : UserSummary
{
    public string Bio { get; init; } = string.Empty;
    public int PostCount { get; init; }
    public int FollowerCount { get; init; }
    public int FollowingCount { get; init; }

    public bool IsMe { get; init; }
    public bool IsFollowing { get; init; }
    public bool FollowRequested { get; init; }
    public bool FollowsYou { get; init; }

    /// <summary>They have a request waiting on your own private account.</summary>
    public bool RequestedYou { get; init; }

    /// <summary>Both edges exist — you follow each other.</summary>
    public bool IsFriend { get; init; }

    /// <summary>How many of their edges run both ways.</summary>
    public int FriendCount { get; init; }

    /// <summary>True when a private account is being viewed by somebody who does not follow it.</summary>
    public bool IsLocked { get; init; }

    /// <summary>You blocked them. Their posts and lists are hidden and you cannot follow them.</summary>
    public bool IsBlocked { get; init; }

    /// <summary>
    /// They blocked you. Deliberately not distinguished from "does not exist" anywhere the client can
    /// see — the profile simply refuses to load.
    /// </summary>
    public bool IsBlockedBy { get; init; }

    /// <summary>You still follow them, but their posts are kept out of your feed.</summary>
    public bool IsMuted { get; init; }

    /// <summary>People you follow who also follow them — the "Followed by …" line.</summary>
    public IReadOnlyList<UserSummary> MutualFollowers { get; init; } = [];

    public int MutualFollowerCount { get; init; }
}

public record UpdateProfileRequest
{
    [StringLength(80)]
    public string FullName { get; init; } = string.Empty;

    [StringLength(300)]
    public string Bio { get; init; } = string.Empty;

    public bool IsPrivate { get; init; }
}

/// <summary>A "Suggested for you" row: the account plus the whole derivation that produced it.</summary>
public record SuggestedUser : UserRelation
{
    /// <summary>e.g. "Followed by priya.lifts + 2 more" or "Popular on InstaGraph".</summary>
    public string Reason { get; init; } = string.Empty;

    public int MutualCount { get; init; }

    /// <summary>Which signal did the most work: FollowsYou, MutualFriends, PopularInCircle, and so on.</summary>
    public string Category { get; init; } = string.Empty;

    /// <summary>The same thing in words, for the tab and the chip on the card.</summary>
    public string CategoryLabel { get; init; } = string.Empty;

    /// <summary>The blended score. Exposed because a suggestion nobody can inspect is a suggestion nobody can argue with.</summary>
    public double Score { get; init; }

    /// <summary>Hops along the shortest route from the viewer, or -1 when no route exists inside four hops.</summary>
    public int Distance { get; init; }

    public int FollowerCount { get; init; }

    /// <summary>The accounts the recommendation actually came through.</summary>
    public IReadOnlyList<UserSummary> Via { get; init; } = [];

    /// <summary>Every signal's reading and what it contributed. Feeds the "why am I seeing this" panel.</summary>
    public IReadOnlyList<SignalBreakdown> Signals { get; init; } = [];
}

/// <summary>One row of the score breakdown.</summary>
public record SignalBreakdown
{
    public string Name { get; init; } = string.Empty;

    /// <summary>The normalised reading, 0 to 1.</summary>
    public double Value { get; init; }

    /// <summary>What it added to — or, when negative, took off — the final score.</summary>
    public double Contribution { get; init; }
}


// ---------------------------------------------------------------- forgotten passwords

/// <summary>
/// Step one of a reset: who you are. A username or an email, the same field the login screen takes,
/// because somebody who has forgotten their password is not reliably going to remember which of the two
/// they signed up with either.
/// </summary>
public record ForgotPasswordRequest
{
    [Required(ErrorMessage = "Enter your username or email address."), StringLength(160)]
    public string Login { get; init; } = string.Empty;
}

/// <summary>
/// What the reset screen is told after asking, which is deliberately the same whether or not an account
/// matched.
///
/// <para>
/// Login already refuses to say whether a username exists; a reset form that happily confirms it would
/// hand that back. So this always returns the same shape and the same message, and the send only
/// actually happens when there is somewhere to send it. What differs is invisible from here.
/// </para>
/// </summary>
public record PasswordResetStarted
{
    /// <summary>Masked — <c>a•••a@g•••.com</c> — so it is recognisable without being disclosed.</summary>
    public string MaskedEmail { get; init; } = string.Empty;

    public DateTime ExpiresAt { get; init; }
    public int ResendInSeconds { get; init; }

    /// <summary>False when no SMTP is configured, exactly as at sign-up.</summary>
    public bool Delivered { get; init; }

    /// <summary>
    /// Development only, no mail server, and only when an account actually matched. It is what makes the
    /// flow completable on a machine with no SMTP; a deployed API never returns it.
    /// </summary>
    public string? DevCode { get; init; }
}

/// <summary>Step two: the six digits, exchanged for the token that the reset itself requires.</summary>
public record VerifyResetCodeRequest
{
    [Required, StringLength(160)]
    public string Login { get; init; } = string.Empty;

    [Required]
    [RegularExpression("^[0-9]{6}$", ErrorMessage = "The confirmation code is six digits.")]
    public string Code { get; init; } = string.Empty;
}

/// <summary>Step three: the new password, and the single-use proof that step two produced.</summary>
public record ResetPasswordRequest
{
    [Required, StringLength(160)]
    public string Login { get; init; } = string.Empty;

    [Required(ErrorMessage = "Confirm the code first.")]
    public string ResetToken { get; init; } = string.Empty;

    [Required, StringLength(PasswordPolicy.MaximumLength, MinimumLength = PasswordPolicy.MinimumLength,
        ErrorMessage = "Your password needs at least 8 characters.")]
    public string NewPassword { get; init; } = string.Empty;
}

/// <summary>
/// Changing a password from settings, which is the other half of the same job and needs no email at all:
/// somebody who can already sign in proves it by typing the password they are replacing.
/// </summary>
public record ChangePasswordRequest
{
    [Required(ErrorMessage = "Enter your current password.")]
    public string CurrentPassword { get; init; } = string.Empty;

    [Required, StringLength(PasswordPolicy.MaximumLength, MinimumLength = PasswordPolicy.MinimumLength,
        ErrorMessage = "Your password needs at least 8 characters.")]
    public string NewPassword { get; init; } = string.Empty;
}

/// <summary>
/// What comes back after a password moves, by either route.
///
/// <para>
/// A fresh token comes with it, because the change ends every session issued before it — including the
/// one that asked. Handing the replacement back in the same response is the difference between "your
/// password is changed" and "your password is changed, please sign in again".
/// </para>
/// </summary>
public record PasswordChangedResponse
{
    public string Token { get; init; } = string.Empty;
    public DateTime ExpiresAt { get; init; }
    public UserSummary User { get; init; } = new();

    /// <summary>Always true, and said out loud because it is the reassuring half of the message.</summary>
    public bool OtherSessionsEnded { get; init; } = true;
}
