using System.Net;
using System.Net.Mail;
using InstaGraph.Api.Common;
using Microsoft.Extensions.Options;

namespace InstaGraph.Api.Services;

public interface IEmailSender
{
    Task SendAsync(string to, string subject, string body, CancellationToken ct = default);

    /// <summary>
    /// Whether mail actually leaves the machine. False means the message was only written to the log,
    /// which is what lets the API tell the client honestly that the code is in the server console
    /// rather than in an inbox that will never receive it.
    /// </summary>
    bool Delivers { get; }
}

/// <summary>
/// Sends through whatever SMTP server is configured, or writes to the log when none is.
///
/// <para>
/// There is deliberately no third behaviour. An app that silently pretends to have sent mail is worse
/// than one that says it did not: somebody would sit waiting for a code that was never going anywhere.
/// With no host configured this logs the whole message at Information and reports
/// <see cref="Delivers"/> as false, and the sign-up screen says where to look.
/// </para>
/// </summary>
public class EmailSender(IOptions<EmailSettings> options, ILogger<EmailSender> logger) : IEmailSender
{
    private readonly EmailSettings settings = options.Value;

    /// <summary>
    /// A host on its own is not a working mail setup. Requiring credentials too — unless a relay has
    /// been explicitly declared open — means a half-filled Email block behaves like no Email block:
    /// the code goes to the log and the sign-up screen says so, rather than the app insisting it sent
    /// something it could not.
    /// </summary>
    public bool Delivers =>
        !string.IsNullOrWhiteSpace(settings.SmtpHost)
        && (!string.IsNullOrWhiteSpace(settings.Username) || settings.AllowAnonymousRelay);

    /// <summary>Falls back to the authenticated account, which is what most providers require.</summary>
    private string From =>
        !string.IsNullOrWhiteSpace(settings.FromAddress) ? settings.FromAddress : settings.Username;

    public async Task SendAsync(string to, string subject, string body, CancellationToken ct = default)
    {
        if (!Delivers)
        {
            var why = string.IsNullOrWhiteSpace(settings.SmtpHost)
                ? "Email:SmtpHost is empty"
                : "Email:Username is empty (set it, or Email:AllowAnonymousRelay for an open relay)";

            logger.LogInformation(
                "Email not configured — nothing was sent, because {Why}.\n"
                + "To: {To}\nSubject: {Subject}\n{Body}", why, to, subject, body);
            return;
        }

        using var client = new SmtpClient(settings.SmtpHost, settings.SmtpPort)
        {
            EnableSsl = settings.UseSsl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Timeout = 15_000
        };

        if (!string.IsNullOrWhiteSpace(settings.Username))
        {
            client.UseDefaultCredentials = false;
            client.Credentials = new NetworkCredential(settings.Username, settings.Password);
        }

        using var mail = new MailMessage
        {
            From = new MailAddress(From, settings.FromName),
            Subject = subject,
            Body = body,
            IsBodyHtml = true
        };

        mail.To.Add(to);

        try
        {
            // SmtpClient's async send does not take a token; the 15s timeout above is the bound.
            await client.SendMailAsync(mail, ct);
            logger.LogInformation("Sent {Subject} to {To}.", subject, to);
        }
        catch (SmtpException ex) when (ex.StatusCode == SmtpStatusCode.MustIssueStartTlsFirst
                                       || ex.StatusCode == SmtpStatusCode.ClientNotPermitted)
        {
            // By far the most common first-run failure, and the one whose own message is least helpful:
            // Google answers an ordinary account password with a permissions error rather than an
            // authentication one, so the log says what it actually means.
            logger.LogError(ex,
                "SMTP refused the credentials for {User}. With Gmail this almost always means the "
                + "password is the account password rather than a 16-character App Password, or that "
                + "2-Step Verification is not switched on. See https://myaccount.google.com/apppasswords",
                settings.Username);

            throw AppException.BadRequest(
                "We could not send the code — the mail server rejected our sign-in. Check the API log.");
        }
        catch (Exception ex)
        {
            // A mail server that is down must not take the sign-up down with it. The code is already
            // stored, so the address owner can ask for it again once the server is back.
            logger.LogError(ex, "Could not send {Subject} to {To}.", subject, to);
            throw AppException.BadRequest(
                "We could not send the code right now. Please try again in a moment.");
        }
    }
}
