import { requireUser } from '../_lib/auth';
import { db, ready } from '../_lib/db';
import { badRequest, body, handler, methods } from '../_lib/http';
import { POST_COLUMNS, POST_JOINS, linkHashtags, toPost, type PostRow } from '../_lib/posts';

/**
 * Creates a post.
 *
 * Media arrives as URLs rather than as bytes. Uploading files needs a blob store, which is a separate
 * piece of setup — until it exists, a post can still be made from an image already on the web, and the
 * rest of the app (feed, explore, likes, comments) works on it exactly the same.
 */
export default handler(async (req) => {
  methods(req, 'POST');

  const me = await requireUser(req);
  const payload = body(req);

  const caption = typeof payload.caption === 'string' ? payload.caption.trim().slice(0, 2200) : '';
  const location = typeof payload.location === 'string' ? payload.location.trim().slice(0, 120) : null;

  const media = Array.isArray(payload.media)
    ? payload.media
        .filter((item): item is { url: string; isVideo?: boolean } =>
          Boolean(item) && typeof (item as { url?: unknown }).url === 'string')
        .slice(0, 10)
    : [];

  if (media.length === 0) {
    throw badRequest('A post needs at least one photo or video.');
  }

  await ready();

  const pool = db();
  const isReel = media.every((item) => item.isVideo === true);

  const created = await pool.query<{ id: number }>(
    `INSERT INTO posts (author_id, caption, location, is_reel) VALUES ($1, $2, $3, $4) RETURNING id`,
    [me.id, caption, location, isReel],
  );

  const postId = created.rows[0].id;

  await Promise.all(
    media.map((item, index) =>
      pool.query(`INSERT INTO post_media (post_id, url, is_video, position) VALUES ($1, $2, $3, $4)`,
        [postId, item.url, item.isVideo === true, index]),
    ),
  );

  await linkHashtags(postId, caption);

  const { rows } = await pool.query<PostRow>(
    `SELECT ${POST_COLUMNS} ${POST_JOINS} WHERE p.id = $2`,
    [me.id, postId],
  );

  return toPost(rows[0], me.id);
});
