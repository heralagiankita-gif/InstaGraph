import nodemailer from 'nodemailer';

/**
 * Sends the six-digit code, or reports honestly that it could not.
 *
 * Mirrors the .NET EmailSender: with no SMTP configured the code is not sent, `delivered` comes back
 * false, and the sign-up screen shows the code with a *Fill it in* button rather than leaving somebody
 * waiting on an inbox that will never receive anything. That is what keeps the deployment usable before
 * the Gmail credentials are set, instead of dead-ending on a screen asking for a number nobody can see.
 */
export const configured = () =>
  Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);

export async function sendCode(to: string, code: string, minutes: number): Promise<boolean> {
  if (!configured()) {
    return false;
  }

  const user = process.env.EMAIL_USER!;

  // Gmail rejects a From header that is not the account it authenticated, so these are the same address
  // unless EMAIL_FROM is deliberately set to something the account is allowed to send as.
  const from = process.env.EMAIL_FROM ?? user;

  try {
    const transport = nodemailer.createTransport({
      host: process.env.EMAIL_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.EMAIL_PORT ?? 587),
      secure: false,
      auth: { user, pass: (process.env.EMAIL_PASSWORD ?? '').replace(/\s+/g, '') },
    });

    await transport.sendMail({
      from: `"InstaGraph" <${from}>`,
      to,
      subject: `${code} is your InstaGraph code`,
      text: `${code}\n\nThis code expires in ${minutes} minutes. If you did not ask for it, ignore this email.`,
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:20px;margin:0 0 8px">Confirm your email</h1>
          <p style="color:#666;margin:0 0 24px">Enter this code to finish signing up.</p>
          <div style="font-size:34px;font-weight:700;letter-spacing:8px;padding:16px;background:#f5f5f7;border-radius:12px;text-align:center">${code}</div>
          <p style="color:#888;font-size:13px;margin:24px 0 0">Expires in ${minutes} minutes. Didn't ask for this? Ignore it.</p>
        </div>`,
    });

    return true;
  } catch (error) {
    // A failed send is not a failed sign-up. The code is already stored, so returning false routes the
    // user down the same path as an unconfigured mailer rather than losing the attempt entirely.
    console.error('SMTP send failed:', error);
    return false;
  }
}
