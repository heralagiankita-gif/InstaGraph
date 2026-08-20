import { checkPassword, issue, summary, type UserRow } from '../auth';
import { db, ready } from '../db';
import { body, handler, methods, text, unauthorized } from '../http';

/** Signs in with a username or an email — Instagram accepts either, so this does too. */
export default handler(async (req) => {
  methods(req, 'POST');

  const payload = body(req);
  const login = text(payload.login, 'Username or email', 160).toLowerCase();
  const password = typeof payload.password === 'string' ? payload.password : '';

  await ready();

  const { rows } = await db().query<UserRow & { password_hash: string; is_active: boolean }>(
    `SELECT id, username, full_name, avatar_url, is_private, is_verified, password_hash, is_active
       FROM users
      WHERE LOWER(username) = $1 OR LOWER(email) = $1`,
    [login],
  );

  const user = rows[0];

  // One message for "no such account" and for "wrong password", on purpose. Telling them apart turns
  // the login form into a way of asking which usernames exist.
  const refuse = () => unauthorized('That username or password is not right.');

  if (!user || !user.is_active) {
    throw refuse();
  }

  if (!(await checkPassword(password, user.password_hash))) {
    throw refuse();
  }

  const { token, expiresAt } = issue(user);

  return { token, expiresAt, user: summary(user) };
});
