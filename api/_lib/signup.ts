import { digest, sixDigits } from './auth';
import { db, ready } from './db';
import { badRequest, conflict, tooMany } from './http';
import { configured, sendCode } from './mail';

// The same ceilings the .NET AuthService uses, so the two implementations cannot drift into disagreeing
// about how many tries somebody gets.
export const CODE_MINUTES = 10;
export const TOKEN_MINUTES = 30;
export const MAX_ATTEMPTS = 5;
export const MAX_SENDS = 5;
export const RESEND_COOLDOWN = 30;

const EMAIL_SHAPE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

export function normaliseEmail(raw: unknown): string {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';

  if (!EMAIL_SHAPE.test(email) || email.length > 160) {
    throw badRequest('That does not look like an email address.');
  }

  return email;
}

/**
 * Step one of three. Sends a code to an address no account is using yet.
 *
 * The order here is the point: the address is confirmed before a `users` row exists, so an address
 * that was never confirmed never becomes an account, and "one account per email" is a fact about the
 * database rather than a promise made by a form.
 */
export async function startSignUp(email: string) {
  await ready();

  const pool = db();

  const taken = await pool.query(`SELECT 1 FROM users WHERE LOWER(email) = $1`, [email]);

  if (taken.rowCount) {
    throw conflict('There is already an account for that email address.');
  }

  const existing = await pool.query<{ sends: number; last_sent_at: Date }>(
    `SELECT sends, last_sent_at FROM email_codes WHERE email = $1`,
    [email],
  );

  let sends = 1;

  if (existing.rowCount) {
    const row = existing.rows[0];
    const since = (Date.now() - new Date(row.last_sent_at).getTime()) / 1000;

    if (row.sends >= MAX_SENDS) {
      throw tooMany('That address has been sent too many codes. Try again later.');
    }

    if (since < RESEND_COOLDOWN) {
      const wait = Math.ceil(RESEND_COOLDOWN - since);
      throw tooMany(`A code was just sent. Please wait ${wait}s before asking for another.`);
    }

    sends = row.sends + 1;
  }

  const code = sixDigits();
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000);

  // Upsert rather than insert: a second attempt for the same address replaces the outstanding code and
  // resets the wrong-guess counter, which is what makes the earlier code stop working.
  await pool.query(
    `INSERT INTO email_codes (email, code_hash, expires_at, attempts, sends, last_sent_at, token_hash, token_expires_at)
     VALUES ($1, $2, $3, 0, $4, NOW(), NULL, NULL)
     ON CONFLICT (email) DO UPDATE
       SET code_hash = EXCLUDED.code_hash,
           expires_at = EXCLUDED.expires_at,
           attempts = 0,
           sends = EXCLUDED.sends,
           last_sent_at = NOW(),
           token_hash = NULL,
           token_expires_at = NULL`,
    [email, digest(code), expiresAt, sends],
  );

  const delivered = await sendCode(email, code, CODE_MINUTES);

  return {
    email,
    expiresAt: expiresAt.toISOString(),
    resendInSeconds: RESEND_COOLDOWN,
    delivered,

    // Shown on screen only when nothing was sent. With SMTP configured this is null and the code exists
    // solely in the inbox. Without it, handing the code back is what keeps the deployment completable
    // rather than dead-ending on a screen asking for a number nobody can see — the same choice the
    // .NET API makes on a Development build.
    devCode: delivered || configured() ? null : code,
  };
}
