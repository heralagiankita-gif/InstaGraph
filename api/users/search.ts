import { requireUser, summary, type UserRow } from '../_lib/auth';
import { db, ready } from '../_lib/db';
import { handler, methods } from '../_lib/http';

/** Search by username or name. Prefix matches rank above matches buried in the middle of a word. */
export default handler(async (req) => {
  methods(req, 'GET');

  const me = await requireUser(req);
  const raw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q ?? '';
  const term = raw.trim().toLowerCase();

  if (term.length === 0) {
    return [];
  }

  await ready();

  const { rows } = await db().query<UserRow>(
    `SELECT id, username, full_name, avatar_url, is_private, is_verified
       FROM users
      WHERE is_active AND (LOWER(username) LIKE $1 OR LOWER(full_name) LIKE $1)
      ORDER BY (LOWER(username) LIKE $2) DESC, username
      LIMIT 20`,
    [`%${term}%`, `${term}%`],
  );

  return rows.map((row) => ({ ...summary(row), isMe: row.id === me.id }));
});
