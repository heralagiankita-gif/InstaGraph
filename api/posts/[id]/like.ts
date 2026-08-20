import { requireUser } from '../../_lib/auth';
import { db, ready } from '../../_lib/db';
import { badRequest, handler, methods, notFound } from '../../_lib/http';

/**
 * Likes and unlikes. POST adds, DELETE removes.
 *
 * The counter on the post is kept by the same statement that writes the row, so the two cannot drift —
 * and ON CONFLICT DO NOTHING means a double tap from two tabs counts once rather than twice.
 */
export default handler(async (req) => {
  methods(req, 'POST', 'DELETE');

  const me = await requireUser(req);
  const raw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const postId = Number(raw);

  if (!Number.isInteger(postId) || postId < 1) {
    throw badRequest('That is not a post id.');
  }

  await ready();

  const pool = db();
  const exists = await pool.query<{ author_id: number }>(`SELECT author_id FROM posts WHERE id = $1`, [postId]);

  if (exists.rowCount === 0) {
    throw notFound('That post is gone.');
  }

  const liking = req.method?.toUpperCase() === 'POST';

  const changed = liking
    ? await pool.query(
        `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [postId, me.id])
    : await pool.query(`DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`, [postId, me.id]);

  if (changed.rowCount) {
    await pool.query(`UPDATE posts SET like_count = like_count + $2 WHERE id = $1`,
      [postId, liking ? 1 : -1]);

    // Nobody needs telling they liked their own post.
    if (liking && exists.rows[0].author_id !== me.id) {
      await pool.query(
        `INSERT INTO notifications (user_id, actor_id, kind, post_id) VALUES ($1, $2, 'like', $3)`,
        [exists.rows[0].author_id, me.id, postId]);
    }
  }

  const count = await pool.query<{ like_count: number }>(`SELECT like_count FROM posts WHERE id = $1`, [postId]);

  return { isLiked: liking, likeCount: count.rows[0].like_count };
});
