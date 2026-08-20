import { requireUser, summary } from '../auth';
import { db, ready } from '../db';
import { badRequest, body, handler, methods, notFound, text } from '../http';
import { page, paging } from '../posts';

interface CommentRow {
  id: number; body: string; like_count: number; created_at: Date; author_id: number;
  uid: number; username: string; full_name: string; avatar_url: string | null;
  is_private: boolean; is_verified: boolean;
}

/** GET reads a post's comments oldest-first; POST adds one. */
export default handler(async (req) => {
  methods(req, 'GET', 'POST');

  const me = await requireUser(req);
  const raw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const postId = Number(raw);

  if (!Number.isInteger(postId) || postId < 1) {
    throw badRequest('That is not a post id.');
  }

  await ready();

  const pool = db();
  const post = await pool.query<{ author_id: number }>(`SELECT author_id FROM posts WHERE id = $1`, [postId]);

  if (post.rowCount === 0) {
    throw notFound('That post is gone.');
  }

  if (req.method?.toUpperCase() === 'POST') {
    const content = text(body(req).body ?? body(req).text, 'Comment', 1000);

    const created = await pool.query<CommentRow>(
      `WITH inserted AS (
         INSERT INTO comments (post_id, author_id, body) VALUES ($1, $2, $3) RETURNING *
       )
       SELECT i.id, i.body, i.like_count, i.created_at, i.author_id,
              u.id AS uid, u.username, u.full_name, u.avatar_url, u.is_private, u.is_verified
         FROM inserted i JOIN users u ON u.id = i.author_id`,
      [postId, me.id, content],
    );

    await pool.query(`UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`, [postId]);

    if (post.rows[0].author_id !== me.id) {
      await pool.query(
        `INSERT INTO notifications (user_id, actor_id, kind, post_id) VALUES ($1, $2, 'comment', $3)`,
        [post.rows[0].author_id, me.id, postId]);
    }

    return shape(created.rows[0], me.id);
  }

  const { pageNumber, pageSize, offset } = paging(req.query, 20, 50);

  const { rows } = await pool.query<CommentRow>(
    `SELECT c.id, c.body, c.like_count, c.created_at, c.author_id,
            u.id AS uid, u.username, u.full_name, u.avatar_url, u.is_private, u.is_verified
       FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.post_id = $1
      ORDER BY c.created_at
      LIMIT $2 OFFSET $3`,
    [postId, pageSize + 1, offset],
  );

  const hasMore = rows.length > pageSize;

  return page(rows.slice(0, pageSize).map((r) => shape(r, me.id)), pageNumber, pageSize, hasMore);
});

const shape = (row: CommentRow, viewerId: number) => ({
  id: row.id,
  body: row.body,
  author: summary({
    id: row.uid, username: row.username, full_name: row.full_name,
    avatar_url: row.avatar_url, is_private: row.is_private, is_verified: row.is_verified,
  }),
  likeCount: row.like_count,
  isLiked: false,
  isMine: row.author_id === viewerId,
  createdAt: row.created_at.toISOString(),
});
