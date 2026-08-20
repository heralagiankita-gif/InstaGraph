import { requireUser } from '../auth';
import { db, ready } from '../db';
import { handler, methods } from '../http';

/** The tags carrying the most posts, for the row across the top of Explore. */
export default handler(async (req) => {
  methods(req, 'GET');

  await requireUser(req);

  const raw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = Math.min(30, Math.max(1, Number(raw) || 10));

  await ready();

  const { rows } = await db().query<{ tag: string; count: string }>(
    `SELECT h.tag, COUNT(*) AS count
       FROM hashtags h JOIN post_hashtags ph ON ph.hashtag_id = h.id
       JOIN posts p ON p.id = ph.post_id AND NOT p.is_archived
      GROUP BY h.tag ORDER BY COUNT(*) DESC, h.tag LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({ tag: row.tag, postCount: Number(row.count) }));
});
