using InstaGraph.Api.DTOs;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace InstaGraph.Api.Controllers;

/// <summary>
/// Signing up is three calls, not one.
///
/// <para>
/// <c>signup/start</c> proves the address exists, <c>signup/verify</c> proves the person asking can read
/// it, and only then does <c>register</c> write a <see cref="Entities.User"/>. Splitting it that way is
/// what makes "one account per email" true rather than merely declared: an address that was never
/// confirmed never becomes a row.
/// </para>
/// </summary>
[Route("api/auth")]
public class AuthController(IAuthService auth, ICurrentUser currentUser) : ApiControllerBase(currentUser)
{
    /// <summary>Sends a six-digit code to an address that no account is using yet.</summary>
    [HttpPost("signup/start")]
    [AllowAnonymous]
    public async Task<ActionResult<SendCodeResponse>> StartSignUp(SendCodeRequest request, CancellationToken ct) =>
        Ok(await auth.SendCodeAsync(request, ct));

    /// <summary>Asks for the code again. Same rate limits as the first send.</summary>
    [HttpPost("signup/resend")]
    [AllowAnonymous]
    public async Task<ActionResult<SendCodeResponse>> ResendCode(SendCodeRequest request, CancellationToken ct) =>
        Ok(await auth.SendCodeAsync(request, ct));

    /// <summary>Exchanges the six digits for the single-use token that register requires.</summary>
    [HttpPost("signup/verify")]
    [AllowAnonymous]
    public async Task<ActionResult<VerifyCodeResponse>> VerifyCode(VerifyCodeRequest request, CancellationToken ct) =>
        Ok(await auth.VerifyCodeAsync(request, ct));

    /// <summary>Whether a username is free, with free alternatives when it is not.</summary>
    [HttpGet("username-available")]
    [AllowAnonymous]
    public async Task<ActionResult<UsernameAvailability>> UsernameAvailable(
        [FromQuery] string username,
        CancellationToken ct) =>
        Ok(await auth.CheckUsernameAsync(username, ct));

    /// <summary>
    /// Creates the account. The new node has no edges yet, so its feed starts out empty.
    ///
    /// <para>
    /// Returns a username rather than a session on purpose — see <see cref="RegisteredResponse"/>.
    /// </para>
    /// </summary>
    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<ActionResult<RegisteredResponse>> Register(RegisterRequest request, CancellationToken ct) =>
        Ok(await auth.RegisterAsync(request, ct));

    /// <summary>Signs in with a username or an email.</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request, CancellationToken ct) =>
        Ok(await auth.LoginAsync(request, ct));

    /// <summary>The account behind the current token.</summary>
    [HttpGet("me")]
    public async Task<ActionResult<UserSummary>> Me(CancellationToken ct) => Ok(await auth.MeAsync(UserId, ct));

    // ------------------------------------------------------------ forgotten password

    /// <summary>
    /// Starts a reset for a username or an email.
    ///
    /// <para>
    /// Answers the same way whether or not an account matched — a reset form that confirms which
    /// usernames exist hands back exactly what login refuses to say. See
    /// <see cref="DTOs.PasswordResetStarted"/>.
    /// </para>
    /// </summary>
    [HttpPost("password/forgot")]
    [AllowAnonymous]
    public async Task<ActionResult<PasswordResetStarted>> ForgotPassword(
        ForgotPasswordRequest request, CancellationToken ct) =>
        Ok(await auth.ForgotPasswordAsync(request, ct));

    /// <summary>Asks for the reset code again. Same ceilings as the first send.</summary>
    [HttpPost("password/resend")]
    [AllowAnonymous]
    public async Task<ActionResult<PasswordResetStarted>> ResendResetCode(
        ForgotPasswordRequest request, CancellationToken ct) =>
        Ok(await auth.ForgotPasswordAsync(request, ct));

    /// <summary>Exchanges the six digits for the single-use token the reset requires.</summary>
    [HttpPost("password/verify")]
    [AllowAnonymous]
    public async Task<ActionResult<VerifyCodeResponse>> VerifyResetCode(
        VerifyResetCodeRequest request, CancellationToken ct) =>
        Ok(await auth.VerifyResetCodeAsync(request, ct));

    /// <summary>
    /// Sets the new password and ends every session issued before now, handing back one fresh token so
    /// the browser that did it stays signed in.
    /// </summary>
    [HttpPost("password/reset")]
    [AllowAnonymous]
    public async Task<ActionResult<PasswordChangedResponse>> ResetPassword(
        ResetPasswordRequest request, CancellationToken ct) =>
        Ok(await auth.ResetPasswordAsync(request, ct));

    /// <summary>
    /// Changes the password from settings. Needs the current one rather than an emailed code, which is
    /// the whole difference between this and the reset above.
    /// </summary>
    [HttpPost("password/change")]
    public async Task<ActionResult<PasswordChangedResponse>> ChangePassword(
        ChangePasswordRequest request, CancellationToken ct) =>
        Ok(await auth.ChangePasswordAsync(UserId, request, ct));
}
