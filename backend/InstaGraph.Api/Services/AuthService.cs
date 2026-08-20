using System.Security.Cryptography;
using System.Text.RegularExpressions;
using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Graph;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace InstaGraph.Api.Services;

public interface IAuthService
{
    Task<SendCodeResponse> SendCodeAsync(SendCodeRequest request, CancellationToken ct = default);
    Task<VerifyCodeResponse> VerifyCodeAsync(VerifyCodeRequest request, CancellationToken ct = default);
    Task<UsernameAvailability> CheckUsernameAsync(string username, CancellationToken ct = default);
    Task<RegisteredResponse> RegisterAsync(RegisterRequest request, CancellationToken ct = default);
    Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken ct = default);
    Task<UserSummary> MeAsync(int userId, CancellationToken ct = default);

    Task<PasswordResetStarted> ForgotPasswordAsync(ForgotPasswordRequest request, CancellationToken ct = default);
    Task<VerifyCodeResponse> VerifyResetCodeAsync(VerifyResetCodeRequest request, CancellationToken ct = default);
    Task<PasswordChangedResponse> ResetPasswordAsync(ResetPasswordRequest request, CancellationToken ct = default);

    Task<PasswordChangedResponse> ChangePasswordAsync(
        int userId, ChangePasswordRequest request, CancellationToken ct = default);
}

public partial class AuthService(
    AppDbContext db,
    ITokenService tokens,
    IGraphSnapshotProvider graph,
    IEmailSender email,
    IOptions<EmailSettings> emailOptions,
    IHostEnvironment environment,
    ILoginThrottle throttle,
    ISessionRevocations revocations,
    IHttpContextAccessor http,
    ILogger<AuthService> logger) : IAuthService
{
    private readonly EmailSettings settings = emailOptions.Value;

    /// <summary>
    /// Names the app needs for its own routes, plus the handful nobody should be able to impersonate.
    /// Checked before the database, because /explore is not "taken" — it is not a username at all.
    /// </summary>
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        "explore", "reels", "messages", "settings", "activity", "create", "discover", "network",
        "archive", "login", "register", "signup", "logout", "p", "tags", "api", "admin",
        "instagraph", "support", "help", "about", "privacy", "terms", "null", "undefined"
    };

    [GeneratedRegex("^[a-z0-9._]{3,30}$")]
    private static partial Regex UsernameShape();

    // ------------------------------------------------------------------ step one

    public async Task<SendCodeResponse> SendCodeAsync(SendCodeRequest request, CancellationToken ct = default)
    {
        var address = Normalise(request.Email);

        // Checked here as well as at register, so somebody does not fill in five fields and a code
        // before being told the address was never available.
        if (await db.Users.AnyAsync(u => u.Email == address, ct))
        {
            throw AppException.Conflict("Another account is using that email.");
        }

        var (verification, code) = await IssueCodeAsync(address, VerificationPurpose.SignUp, ct);

        await email.SendAsync(
            address,
            "Your InstaGraph confirmation code",
            SignUpBody(code, settings.CodeLifetimeMinutes),
            ct);

        if (!email.Delivers)
        {
            logger.LogWarning("Confirmation code for {Email} is {Code} (no SMTP configured).", address, code);
        }

        return new SendCodeResponse
        {
            Email = address,
            ExpiresAt = verification.ExpiresAt,
            ResendInSeconds = settings.ResendCooldownSeconds,
            Delivered = email.Delivers,

            // Only when there is genuinely nowhere for the mail to go, and only off a development
            // build. On a deployed API this is always null even with SMTP unconfigured.
            DevCode = !email.Delivers && environment.IsDevelopment() ? code : null
        };
    }

    /// <summary>
    /// Writes a fresh code for an address, subject to the ceilings, and returns it in the clear exactly
    /// once — to the caller that is about to email it.
    ///
    /// <para>
    /// Shared by sign-up and by the password reset, because the two want identical behaviour from the
    /// row: the same ten-minute life, the same five wrong guesses, the same resend cooldown, and the same
    /// refusal to keep two live codes for one address. The only thing they do not share is the row
    /// itself, which is what <see cref="VerificationPurpose"/> is for.
    /// </para>
    /// </summary>
    private async Task<(EmailVerification Verification, string Code)> IssueCodeAsync(
        string address, VerificationPurpose purpose, CancellationToken ct)
    {
        var now = DateTime.UtcNow;

        var existing = await db.EmailVerifications
            .Where(v => v.Email == address && v.Purpose == purpose && v.ConsumedAt == null)
            .OrderByDescending(v => v.Id)
            .FirstOrDefaultAsync(ct);

        // A live code gets resent rather than replaced, so the ceilings actually bind. Replacing the row
        // on every request would reset the counters and make both of them meaningless.
        if (existing is not null && existing.ExpiresAt > now)
        {
            var since = (now - existing.CreatedAt).TotalSeconds;

            if (existing.Sends >= settings.MaxSends)
            {
                throw AppException.BadRequest(
                    "Too many codes have been sent to that address. Please wait a few minutes and try again.");
            }

            if (since < settings.ResendCooldownSeconds)
            {
                throw AppException.BadRequest(
                    $"A code was just sent. Please wait {settings.ResendCooldownSeconds - (int)since}s before asking for another.");
            }
        }

        var code = NewCode();

        var verification = new EmailVerification
        {
            Email = address,
            Purpose = purpose,
            CodeHash = Hash(code),
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(settings.CodeLifetimeMinutes),
            Attempts = 0,
            Sends = existing is not null && existing.ExpiresAt > now ? existing.Sends + 1 : 1
        };

        // The previous code stops working the moment a new one is issued; two live codes for one
        // address would double the guessing surface for no benefit.
        if (existing is not null)
        {
            existing.ConsumedAt = now;
        }

        db.EmailVerifications.Add(verification);
        await db.SaveChangesAsync(ct);

        return (verification, code);
    }

    // ------------------------------------------------------------------ step two

    public async Task<VerifyCodeResponse> VerifyCodeAsync(VerifyCodeRequest request, CancellationToken ct = default)
    {
        var address = Normalise(request.Email);
        var now = DateTime.UtcNow;

        return await RedeemCodeAsync(address, VerificationPurpose.SignUp, request.Code, ct);
    }

    /// <summary>
    /// Checks six digits against the live row for an address and, when they match, replaces the code with
    /// a single-use token.
    ///
    /// <para>
    /// Shared by both flows for the same reason the issuing is: the attempt ceiling, the expiry and the
    /// constant-time comparison are the parts that make a six-digit number a factor at all, and a second
    /// copy of them is a second chance to get one of them subtly wrong.
    /// </para>
    /// </summary>
    private async Task<VerifyCodeResponse> RedeemCodeAsync(
        string address, VerificationPurpose purpose, string code, CancellationToken ct)
    {
        var now = DateTime.UtcNow;

        var verification = await db.EmailVerifications
            .Where(v => v.Email == address && v.Purpose == purpose && v.ConsumedAt == null)
            .OrderByDescending(v => v.Id)
            .FirstOrDefaultAsync(ct)
            ?? throw AppException.BadRequest("Ask for a confirmation code first.");

        if (verification.ExpiresAt <= now)
        {
            throw AppException.BadRequest("That code has expired. Ask for a new one.");
        }

        if (verification.Attempts >= settings.MaxAttempts)
        {
            throw AppException.BadRequest("Too many incorrect codes. Ask for a new one.");
        }

        if (!FixedTimeEquals(verification.CodeHash, Hash(code)))
        {
            verification.Attempts++;
            await db.SaveChangesAsync(ct);

            var left = settings.MaxAttempts - verification.Attempts;

            throw AppException.BadRequest(left > 0
                ? $"That code is not right. {left} {(left == 1 ? "try" : "tries")} left."
                : "Too many incorrect codes. Ask for a new one.");
        }

        // Correct. Issue the proof and let whatever comes next spend it.
        verification.VerifiedAt = now;
        verification.VerificationToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        verification.ExpiresAt = now.AddMinutes(settings.TokenLifetimeMinutes);

        await db.SaveChangesAsync(ct);

        return new VerifyCodeResponse
        {
            VerificationToken = verification.VerificationToken,
            ExpiresAt = verification.ExpiresAt
        };
    }

    // ------------------------------------------------------------ username check

    public async Task<UsernameAvailability> CheckUsernameAsync(string username, CancellationToken ct = default)
    {
        var name = (username ?? string.Empty).Trim().ToLowerInvariant();

        if (!UsernameShape().IsMatch(name))
        {
            return new UsernameAvailability
            {
                Username = name,
                Available = false,
                Reason = "Usernames are 3–30 characters, using lower-case letters, numbers, dots and underscores."
            };
        }

        if (Reserved.Contains(name))
        {
            return new UsernameAvailability { Username = name, Available = false, Reason = "That username is not available." };
        }

        if (!await db.Users.AnyAsync(u => u.Username == name, ct))
        {
            return new UsernameAvailability { Username = name, Available = true };
        }

        return new UsernameAvailability
        {
            Username = name,
            Available = false,
            Reason = "That username is taken.",
            Suggestions = await SuggestAsync(name, ct)
        };
    }

    /// <summary>
    /// Three free variations on a taken name. Generated then filtered in one query rather than probed
    /// one at a time, so a busy name costs the same as a free one.
    /// </summary>
    private async Task<string[]> SuggestAsync(string name, CancellationToken ct)
    {
        var stem = name.Length > 24 ? name[..24] : name;

        var candidates = new List<string>
        {
            $"{stem}_", $"{stem}.official", $"real{stem}", $"{stem}1", $"{stem}_1",
            $"{stem}{DateTime.UtcNow:mmss}", $"its{stem}", $"{stem}.hq"
        };

        candidates = candidates.Where(c => c.Length <= 30 && UsernameShape().IsMatch(c)).Distinct().ToList();

        var taken = await db.Users
            .Where(u => candidates.Contains(u.Username))
            .Select(u => u.Username)
            .ToListAsync(ct);

        return candidates.Except(taken).Take(3).ToArray();
    }

    // ---------------------------------------------------------------- step three

    public async Task<RegisteredResponse> RegisterAsync(RegisterRequest request, CancellationToken ct = default)
    {
        var username = request.Username.Trim().ToLowerInvariant();
        var address = Normalise(request.Email);
        var now = DateTime.UtcNow;

        // ---------------------------------------------------------------- the proof

        var verification = await db.EmailVerifications
            .Where(v => v.Email == address
                        && v.Purpose == VerificationPurpose.SignUp
                        && v.VerificationToken == request.VerificationToken
                        && v.ConsumedAt == null)
            .FirstOrDefaultAsync(ct)
            ?? throw AppException.BadRequest("Confirm your email address again — that link has already been used.");

        if (verification.VerifiedAt is null || verification.ExpiresAt <= now)
        {
            throw AppException.BadRequest("That confirmation has expired. Start again to get a new code.");
        }

        // ------------------------------------------------------------- the account

        if (Reserved.Contains(username))
        {
            throw AppException.Conflict("That username is not available.");
        }

        if (await db.Users.AnyAsync(u => u.Username == username, ct))
        {
            throw AppException.Conflict("That username is taken.");
        }

        if (await db.Users.AnyAsync(u => u.Email == address, ct))
        {
            throw AppException.Conflict("Another account is using that email.");
        }

        var dob = request.DateOfBirth!.Value;
        var age = AgeOn(dob, DateOnly.FromDateTime(now));

        if (age < 13)
        {
            throw AppException.BadRequest("You have to be at least 13 years old to use InstaGraph.");
        }

        if (age > 120)
        {
            throw AppException.BadRequest("Please enter a real date of birth.");
        }

        PasswordPolicy.Enforce(request.Password, username);

        var user = new User
        {
            Username = username,
            Email = address,
            EmailConfirmed = true,
            DateOfBirth = dob,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            FullName = request.FullName.Trim()
        };

        db.Users.Add(user);

        // Spent in the same transaction as the account it created, so the token cannot be replayed even
        // if two requests arrive at once.
        verification.ConsumedAt = now;

        await db.SaveChangesAsync(ct);

        // A brand-new account is an isolated node: no edges, so nothing to traverse and an empty feed
        // until it follows somebody. The graph still has to know it exists.
        graph.Invalidate();

        logger.LogInformation("New account @{Username}.", username);

        return new RegisteredResponse { Username = user.Username, Email = user.Email };
    }

    // --------------------------------------------------------------------- login

    public async Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken ct = default)
    {
        var login = request.Login.Trim().ToLowerInvariant();
        var ip = ClientIp();

        // Asked before the database is touched. A locked-out caller should cost nothing — including the
        // BCrypt verify, which is expensive on purpose and would otherwise make the lockout a way to
        // spend the server's CPU rather than a way to stop spending it.
        if (throttle.RetryAfter(login, ip) is { } wait)
        {
            throw AppException.TooManyRequests(
                $"Too many sign-in attempts. Try again in {Describe(wait)}, or reset your password.");
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == login || u.Email == login, ct);

        // Same message either way, so the response cannot be used to enumerate accounts.
        if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            var locked = throttle.Fail(login, ip);

            throw locked is { } until
                ? AppException.TooManyRequests(
                    $"Too many sign-in attempts. Try again in {Describe(until)}, or reset your password.")
                : AppException.Unauthorized("Sorry, your password was incorrect. Please double-check it.");
        }

        if (!user.IsActive)
        {
            throw AppException.Forbidden("This account has been disabled.");
        }

        throttle.Succeed(login, ip);

        var (token, expiresAt) = tokens.Create(user);

        return new AuthResponse { Token = token, ExpiresAt = expiresAt, User = user.ToSummary() };
    }

    // ----------------------------------------------------------- forgotten password

    /// <summary>
    /// Step one of a reset. Always answers the same way.
    ///
    /// <para>
    /// The temptation is to say "no account with that username", because it is the more helpful message
    /// and every user who sees it wanted it. It is also a free account-existence oracle attached to an
    /// unauthenticated endpoint, which undoes the care taken to make login's two failures
    /// indistinguishable. So the shape and the message are fixed, and the only thing that varies is
    /// whether an email actually goes out.
    /// </para>
    ///
    /// <para>
    /// The masked address is the compromise that keeps it usable: <c>a•••a@g•••.com</c> is enough for
    /// somebody to recognise their own inbox and not enough to learn anybody else's. When no account
    /// matched, the mask is derived from what was typed, so even the shape of the answer gives nothing
    /// away.
    /// </para>
    /// </summary>
    public async Task<PasswordResetStarted> ForgotPasswordAsync(
        ForgotPasswordRequest request, CancellationToken ct = default)
    {
        var login = request.Login.Trim().ToLowerInvariant();
        var now = DateTime.UtcNow;

        // Rate-limited on the same counter as signing in, because it is the same kind of request against
        // the same account: unauthenticated, repeatable, and worth nothing to anybody in volume.
        if (throttle.RetryAfter("reset:" + login, ClientIp()) is { } wait)
        {
            throw AppException.TooManyRequests($"Too many attempts. Try again in {Describe(wait)}.");
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == login || u.Email == login, ct);

        // A disabled account is treated as no account, for the same reason: the difference is not the
        // reset screen's business.
        if (user is null || !user.IsActive)
        {
            throttle.Fail("reset:" + login, ClientIp());

            return new PasswordResetStarted
            {
                MaskedEmail = Mask(login),
                ExpiresAt = now.AddMinutes(settings.CodeLifetimeMinutes),
                ResendInSeconds = settings.ResendCooldownSeconds,
                Delivered = email.Delivers
            };
        }

        var (verification, code) = await IssueCodeAsync(user.Email, VerificationPurpose.PasswordReset, ct);

        await email.SendAsync(
            user.Email,
            "Reset your InstaGraph password",
            ResetBody(code, user.Username, settings.CodeLifetimeMinutes),
            ct);

        if (!email.Delivers)
        {
            logger.LogWarning("Password reset code for @{Username} is {Code} (no SMTP configured).",
                user.Username, code);
        }

        return new PasswordResetStarted
        {
            MaskedEmail = Mask(user.Email),
            ExpiresAt = verification.ExpiresAt,
            ResendInSeconds = settings.ResendCooldownSeconds,
            Delivered = email.Delivers,
            DevCode = !email.Delivers && environment.IsDevelopment() ? code : null
        };
    }

    /// <summary>Step two: six digits for a single-use reset token.</summary>
    public async Task<VerifyCodeResponse> VerifyResetCodeAsync(
        VerifyResetCodeRequest request, CancellationToken ct = default)
    {
        var user = await FindForResetAsync(request.Login, ct);

        return await RedeemCodeAsync(user.Email, VerificationPurpose.PasswordReset, request.Code, ct);
    }

    /// <summary>
    /// Step three: the new password.
    ///
    /// <para>
    /// The token is consumed in the same <c>SaveChanges</c> as the hash it authorises, so two requests
    /// arriving together cannot both spend it. And the change ends every session issued before now —
    /// which, for the one case a reset exists to handle, is the entire point of the exercise.
    /// </para>
    /// </summary>
    public async Task<PasswordChangedResponse> ResetPasswordAsync(
        ResetPasswordRequest request, CancellationToken ct = default)
    {
        var user = await FindForResetAsync(request.Login, ct);
        var now = DateTime.UtcNow;

        var verification = await db.EmailVerifications
            .Where(v => v.Email == user.Email
                        && v.Purpose == VerificationPurpose.PasswordReset
                        && v.VerificationToken == request.ResetToken
                        && v.ConsumedAt == null)
            .FirstOrDefaultAsync(ct)
            ?? throw AppException.BadRequest("That reset has already been used. Start again to get a new code.");

        if (verification.VerifiedAt is null || verification.ExpiresAt <= now)
        {
            throw AppException.BadRequest("That reset has expired. Start again to get a new code.");
        }

        PasswordPolicy.Enforce(request.NewPassword, user.Username);

        // Refusing the password they already had is not security — somebody who reached this screen has
        // proved control of the inbox either way — but it is almost always a mistake, and saying so is
        // better than silently doing nothing.
        if (BCrypt.Net.BCrypt.Verify(request.NewPassword, user.PasswordHash))
        {
            throw AppException.BadRequest("That is the password you are already using. Pick a different one.");
        }

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        user.PasswordChangedAt = now;
        verification.ConsumedAt = now;

        await db.SaveChangesAsync(ct);

        // Whatever lockout the forgotten password produced is spent; the new one deserves a clean slate.
        throttle.Succeed(user.Username, ClientIp());
        throttle.Succeed(user.Email, ClientIp());

        return AfterPasswordChange(user, now, "reset");
    }

    // ------------------------------------------------------------ change password

    /// <summary>
    /// The other route to the same place: no email, because somebody who can already sign in proves it
    /// by typing the password they are replacing.
    /// </summary>
    public async Task<PasswordChangedResponse> ChangePasswordAsync(
        int userId, ChangePasswordRequest request, CancellationToken ct = default)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct)
                   ?? throw AppException.Unauthorized();

        var now = DateTime.UtcNow;
        var key = "change:" + user.Username;

        // The current-password box is a password prompt like any other, so it is counted like one.
        if (throttle.RetryAfter(key, ClientIp()) is { } wait)
        {
            throw AppException.TooManyRequests($"Too many attempts. Try again in {Describe(wait)}.");
        }

        if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword, user.PasswordHash))
        {
            throttle.Fail(key, ClientIp());
            throw AppException.BadRequest("Your current password is not right.");
        }

        throttle.Succeed(key, ClientIp());

        PasswordPolicy.Enforce(request.NewPassword, user.Username);

        if (request.NewPassword == request.CurrentPassword)
        {
            throw AppException.BadRequest("Your new password has to be different from the old one.");
        }

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        user.PasswordChangedAt = now;

        await db.SaveChangesAsync(ct);

        return AfterPasswordChange(user, now, "change");
    }

    /// <summary>
    /// What both routes do once the hash has moved: end everything issued before now, then hand back one
    /// new session so the person who asked is not signed out by their own action.
    /// </summary>
    private PasswordChangedResponse AfterPasswordChange(User user, DateTime now, string via)
    {
        revocations.RevokeBefore(user.Id, now);

        var (token, expiresAt) = tokens.Create(user);

        logger.LogInformation("Password {Via} for @{Username}; earlier sessions ended.", via, user.Username);

        return new PasswordChangedResponse
        {
            Token = token,
            ExpiresAt = expiresAt,
            User = user.ToSummary(),
            OtherSessionsEnded = true
        };
    }

    /// <summary>
    /// The account behind a reset, for the two steps that come after the first one.
    ///
    /// <para>
    /// This one is allowed to fail loudly, unlike step one. By the time somebody is typing a code they
    /// have already been told an address exists, so refusing to say the login is unknown would only
    /// strand a legitimate typo on a screen with no way out.
    /// </para>
    /// </summary>
    private async Task<User> FindForResetAsync(string login, CancellationToken ct)
    {
        var normalised = login.Trim().ToLowerInvariant();

        var user = await db.Users
            .FirstOrDefaultAsync(u => u.Username == normalised || u.Email == normalised, ct);

        return user is null || !user.IsActive
            ? throw AppException.BadRequest("Start again — that reset is no longer valid.")
            : user;
    }

    public async Task<UserSummary> MeAsync(int userId, CancellationToken ct = default)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct)
                   ?? throw AppException.Unauthorized();

        return user.ToSummary();
    }

    // ------------------------------------------------------------------- helpers

    private static string Normalise(string email) => email.Trim().ToLowerInvariant();

    /// <summary>
    /// Six digits, from the cryptographic generator rather than Random. The whole point of the code is
    /// that it cannot be guessed, and a seeded PRNG shared by every request undoes that.
    /// </summary>
    private static string NewCode() => RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

    private static string Hash(string code) =>
        Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(code)));

    /// <summary>Compared without an early exit, so the time taken says nothing about how much matched.</summary>
    private static bool FixedTimeEquals(string a, string b) =>
        a.Length == b.Length
        && CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(a),
            System.Text.Encoding.UTF8.GetBytes(b));

    /// <summary>Whole years, taking the month and day into account rather than subtracting years.</summary>
    private static int AgeOn(DateOnly birth, DateOnly today)
    {
        var age = today.Year - birth.Year;
        if (birth > today.AddYears(-age)) age--;
        return age;
    }

    /// <summary>Where the client is asking from, for the half of the throttle that is not the account.</summary>
    private string? ClientIp() => http.HttpContext?.Connection.RemoteIpAddress?.ToString();

    /// <summary>"45 seconds" or "5 minutes" — a lockout is only useful if it says how long it lasts.</summary>
    private static string Describe(TimeSpan left)
    {
        var seconds = Math.Max(1, (int)Math.Ceiling(left.TotalSeconds));

        if (seconds < 60)
        {
            return $"{seconds} second{(seconds == 1 ? "" : "s")}";
        }

        var minutes = (int)Math.Ceiling(seconds / 60.0);

        return $"{minutes} minute{(minutes == 1 ? "" : "s")}";
    }

    /// <summary>
    /// <c>ankita@gmail.com</c> becomes <c>an•••a@g•••.com</c>: enough to recognise your own address,
    /// not enough to learn somebody else's. The first and last character of the local part survive
    /// because that is what people actually recognise an address by.
    /// </summary>
    private static string Mask(string address)
    {
        if (string.IsNullOrWhiteSpace(address))
        {
            return "•••";
        }

        var at = address.IndexOf('@');

        if (at <= 0)
        {
            // Not an address at all — somebody typed a username. Masked the same way so the answer looks
            // identical either way.
            return Veil(address);
        }

        var local = address[..at];
        var domain = address[(at + 1)..];
        var dot = domain.LastIndexOf('.');

        var tail = dot > 0 ? domain[dot..] : string.Empty;
        var host = dot > 0 ? domain[..dot] : domain;

        return $"{Veil(local)}@{Veil(host)}{tail}";
    }

    /// <summary>Keeps the first and last character and replaces the middle with three dots.</summary>
    private static string Veil(string part) => part.Length switch
    {
        0 => "•••",
        1 or 2 => part[..1] + "•••",
        _ => part[..1] + "•••" + part[^1..]
    };

    private static string SignUpBody(string code, int minutes) => $"""
        <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:460px;margin:0 auto">
          <h1 style="font-size:22px;margin:0 0 6px">Confirm your email</h1>
          <p style="color:#666;margin:0 0 22px">Enter this code to finish setting up your InstaGraph account.</p>
          <p style="font-size:38px;font-weight:800;letter-spacing:10px;margin:0 0 22px">{code}</p>
          <p style="color:#666;font-size:13px;margin:0">
            The code expires in {minutes} minutes. If you did not ask for it, you can ignore this email —
            no account has been created.
          </p>
        </div>
        """;

    private static string ResetBody(string code, string username, int minutes) => $"""
        <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:460px;margin:0 auto">
          <h1 style="font-size:22px;margin:0 0 6px">Reset your password</h1>
          <p style="color:#666;margin:0 0 22px">
            Enter this code to set a new password for <strong>&#64;{username}</strong>.
          </p>
          <p style="font-size:38px;font-weight:800;letter-spacing:10px;margin:0 0 22px">{code}</p>
          <p style="color:#666;font-size:13px;margin:0">
            The code expires in {minutes} minutes. If you did not ask to reset your password you can
            ignore this email — nothing has changed, and whoever asked was not told your address.
          </p>
        </div>
        """;
}
