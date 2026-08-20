namespace InstaGraph.Api.Common;

/// <summary>
/// The one place that decides whether a password is good enough.
///
/// <para>
/// It lives here rather than inside <c>AuthService</c> because three different flows now ask the same
/// question — sign-up, a reset from the forgotten-password screen, and a change from settings — and a
/// rule that is written out three times is a rule that will disagree with itself.
/// </para>
///
/// <para>
/// Length is most of what makes a password hard, so the rule is a floor on length plus a refusal of the
/// two things that defeat any length: the account's own name, and the handful of strings that top every
/// breach list. Two of the four character classes rather than all four, because demanding all four
/// produces <c>P@ssw0rd1</c> and nothing safer.
/// </para>
/// </summary>
public static class PasswordPolicy
{
    /// <summary>Kept public so the DTO annotation and the message can never drift apart.</summary>
    public const int MinimumLength = 8;

    public const int MaximumLength = 100;

    /// <summary>
    /// The strings that top every breach list. Short by design — a long list belongs in a file, and the
    /// length floor already removes most of what would be on one.
    /// </summary>
    private static readonly string[] Common =
    [
        "password", "12345678", "123456789", "qwerty123", "111111", "iloveyou",
        "instagram", "abc12345", "password1", "letmein1", "admin123"
    ];

    /// <summary>
    /// True when the password passes. When it does not, <paramref name="weakness"/> carries the one
    /// thing that is wrong with it, phrased for a person rather than a log.
    /// </summary>
    public static bool IsStrongEnough(string? password, string username, out string weakness)
    {
        weakness = string.Empty;
        password ??= string.Empty;

        if (password.Length < MinimumLength)
        {
            weakness = $"Your password needs at least {MinimumLength} characters.";
            return false;
        }

        if (password.Length > MaximumLength)
        {
            weakness = $"Your password cannot be longer than {MaximumLength} characters.";
            return false;
        }

        if (username.Length >= 3 && password.Contains(username, StringComparison.OrdinalIgnoreCase))
        {
            weakness = "Your password cannot contain your username.";
            return false;
        }

        if (Common.Contains(password, StringComparer.OrdinalIgnoreCase))
        {
            weakness = "That password is too common. Pick something harder to guess.";
            return false;
        }

        var classes = 0;
        if (password.Any(char.IsLower)) classes++;
        if (password.Any(char.IsUpper)) classes++;
        if (password.Any(char.IsDigit)) classes++;
        if (password.Any(c => !char.IsLetterOrDigit(c))) classes++;

        if (classes < 2)
        {
            weakness = "Mix letters with numbers or symbols.";
            return false;
        }

        return true;
    }

    /// <summary>Throws the 400 the client already knows how to render, or returns quietly.</summary>
    public static void Enforce(string? password, string username)
    {
        if (!IsStrongEnough(password, username, out var weakness))
        {
            throw AppException.BadRequest(weakness);
        }
    }
}
