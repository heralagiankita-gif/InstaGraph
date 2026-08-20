import { requireUser } from '../auth';
import { db, ready } from '../db';
import { badRequest, handler, methods, notFound } from '../http';

/**
 * Follows and unfollows. POST adds the edge, DELETE removes it.
 *
 * A follow of a private account is created pending: the edge exists but is not active, which is what
 * makes a request different from a follow rather than a second table.
 */
export default handler(async (req) => {
  methods(req, 'POST', 'DELETE');

  const me = await requireUser(req);
  const raw = Array.isArray(req.query.username) ? req.query.username[0] : req.query.username ?? '';
  const username = raw.trim().toLowerCase();

  await ready();

  const pool = db();

  const target = await pool.query<{ id: number; is_private: boolean }>(
    `SELECT id, is_private FROM users WHERE LOWER(username) = $1 AND is_active`, [username]);

  if (target.rowCount === 0) {
    throw notFound('No such account.');
  }

  const them = target.rows[0];

  if (them.id === me.id) {
    throw badRequest('You cannot follow yourself.');
  }

  if (req.method?.toUpperCase() === 'POST') {
    await pool.query(
      `INSERT INTO follows (follower_id, followee_id, is_pending) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [me.id, them.id, them.is_private]);

    await pool.query(
      `INSERT INTO notifications (user_id, actor_id, kind) VALUES ($1, $2, $3)`,
      [them.id, me.id, them.is_private ? 'follow_request' : 'follow']);
  } else {
    await pool.query(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [me.id, them.id]);
  }

  const state = await pool.query<{ is_pending: boolean }>(
    `SELECT is_pending FROM follows WHERE follower_id = $1 AND followee_id = $2`, [me.id, them.id]);

  const followerCount = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM follows WHERE followee_id = $1 AND NOT is_pending`, [them.id]);

  return {
    isFollowing: state.rows.length > 0 && !state.rows[0].is_pending,
    isRequested: state.rows.length > 0 && state.rows[0].is_pending,
    followerCount: Number(followerCount.rows[0].count),
  };
});
