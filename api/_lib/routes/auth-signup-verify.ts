import { digest, randomToken } from '../auth';
import { db, ready } from '../db';
import { badRequest, body, handler, methods, tooMany } from '../http';
import { MAX_ATTEMPTS, TOKEN_MINUTES, normaliseEmail } from '../signup';

/**
 * Step two of three: exchange the six digits for the single-use token that register requires.
 *
 * The token is not a session. It proves one thing — that whoever is asking can read that inbox — and
 * it can do nothing else, which is why handing it to the browser is safe in a way a real token would
 * not be.
 */
export default handler(async (req) => {
  methods(req, 'POST');

  const payload = body(req);
  const email = normaliseEmail(payload.email);
  const code = typeof payload.code === 'string' ? payload.code.trim() : '';

  if (!/^[0-9]{6}$/.test(code)) {
    throw badRequest('The confirmation code is six digits.');
  }

  await ready();

  const pool = db();

  const found = await pool.query<{ code_hash: string; expires_at: Date; attempts: number }>(
    `SELECT code_hash, expires_at, attempts FROM email_codes WHERE email = $1`,
    [email],
  );

  if (found.rowCount === 0) {
    throw badRequest('Ask for a code first.');
  }

  const row = found.rows[0];

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw badRequest('That code has expired. Ask for a new one.');
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    throw tooMany('Too many wrong codes. Ask for a new one.');
  }

  if (row.code_hash !== digest(code)) {
    // Count the miss before answering, so the ceiling holds even if the caller never stops guessing.
    const used = await pool.query<{ attempts: number }>(
      `UPDATE email_codes SET attempts = attempts + 1 WHERE email = $1 RETURNING attempts`,
      [email],
    );

    const left = MAX_ATTEMPTS - used.rows[0].attempts;

    throw badRequest(
      left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.',
    );
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + TOKEN_MINUTES * 60_000);

  // The code is spent the moment it works. Blanking the hash rather than deleting the row keeps the
  // send ceiling in place, so a verified address cannot be used to mint fresh codes indefinitely.
  await pool.query(
    `UPDATE email_codes
        SET token_hash = $2, token_expires_at = $3, code_hash = '', attempts = 0
      WHERE email = $1`,
    [email, digest(token), expiresAt],
  );

  return { verificationToken: token, expiresAt: expiresAt.toISOString() };
});
