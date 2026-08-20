import { digest, hashPassword } from '../auth';
import { db, ready } from '../db';
import { badRequest, body, conflict, handler, methods, text } from '../http';
import { normaliseEmail } from '../signup';
import { checkUsername } from '../usernames';

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 100;
const MIN_AGE = 13;

/**
 * Step three of three: create the account.
 *
 * Returns a username rather than a session, deliberately. Signing somebody straight in is one round
 * trip shorter and also the moment they are least likely to remember what they just typed; sending
 * them to the login screen with the username filled in means the first thing a new account does is
 * prove it knows its own password.
 */
export default handler(async (req) => {
  methods(req, 'POST');

  const payload = body(req);

  const email = normaliseEmail(payload.email);
  const fullName = text(payload.fullName, 'Your name', 80);
  const password = typeof payload.password === 'string' ? payload.password : '';
  const verificationToken = text(payload.verificationToken, 'Email confirmation', 200);

  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw badRequest(`Your password needs at least ${MIN_PASSWORD} characters.`);
  }

  const birth = parseDate(payload.dateOfBirth);

  if (age(birth) < MIN_AGE) {
    throw badRequest(`You have to be at least ${MIN_AGE} years old to use InstaGraph.`);
  }

  await ready();

  const pool = db();

  const availability = await checkUsername(text(payload.username, 'Username', 30));

  if (!availability.available) {
    throw conflict(availability.reason ?? 'That username is not available.');
  }

  // The token has to still be outstanding, still unexpired, and belong to this address. Without all
  // three the address was never confirmed and no row should be written.
  const proof = await pool.query<{ token_expires_at: Date }>(
    `SELECT token_expires_at FROM email_codes WHERE email = $1 AND token_hash = $2`,
    [email, digest(verificationToken)],
  );

  if (proof.rowCount === 0) {
    throw badRequest('Confirm your email address first.');
  }

  if (new Date(proof.rows[0].token_expires_at).getTime() < Date.now()) {
    throw badRequest('That confirmation expired. Start again.');
  }

  const hash = await hashPassword(password);

  let created;

  try {
    created = await pool.query<{ username: string; email: string }>(
      `INSERT INTO users (username, email, password_hash, full_name, date_of_birth)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING username, email`,
      [availability.username, email, hash, fullName, birth],
    );
  } catch (error) {
    // The unique indexes are the real arbiter: two sign-ups can pass the availability check at the
    // same moment on two instances, and only one of them can win at the database.
    if ((error as { code?: string }).code === '23505') {
      throw conflict('That username or email was just taken. Try another.');
    }

    throw error;
  }

  // The confirmation is spent. Deleting it also frees the address's send ceiling for a future reset.
  await pool.query(`DELETE FROM email_codes WHERE email = $1`, [email]);

  return { username: created.rows[0].username, email: created.rows[0].email };
});

function parseDate(value: unknown): Date {
  const raw = typeof value === 'string' ? value : '';
  const parsed = new Date(raw);

  if (!raw || Number.isNaN(parsed.getTime())) {
    throw badRequest('Enter your date of birth.');
  }

  return parsed;
}

/** Whole years, taking the month and day into account rather than subtracting years. */
function age(birth: Date): number {
  const today = new Date();
  let years = today.getUTCFullYear() - birth.getUTCFullYear();

  const month = today.getUTCMonth() - birth.getUTCMonth();

  if (month < 0 || (month === 0 && today.getUTCDate() < birth.getUTCDate())) {
    years -= 1;
  }

  return years;
}
