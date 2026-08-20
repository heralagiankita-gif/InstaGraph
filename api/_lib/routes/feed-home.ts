import { requireUser } from '../auth';
import { db, ready } from '../db';
import { handler, methods } from '../http';
import { POST_COLUMNS, POST_JOINS, page, paging, toPost, type PostRow } from '../posts';

/**
 * The home feed: posts from the accounts you follow, newest first.
 *
 * Deliberately not "everything, filtered" — a feed that reads the whole table and discards most of it
 * gets slower as the app gets more popular, which is the wrong way round. Your own posts are included:
 * an account with no follows yet should still see something it made.
 */
export default handler(async (req) => {
  methods(req, 'GET');

  const me = await requireUser(req);
  const { pageNumber, pageSize, offset } = paging(req.query, 8, 30);

  await ready();

  const { rows } = await db().query<PostRow>(
    `SELECT ${POST_COLUMNS} ${POST_JOINS}
      WHERE NOT p.is_archived
        AND (p.author_id = $1 OR p.author_id IN (
              SELECT followee_id FROM follows WHERE follower_id = $1 AND NOT is_pending))
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3`,
    [me.id, pageSize + 1, offset],
  );

  const hasMore = rows.length > pageSize;

  return page(rows.slice(0, pageSize).map((r) => toPost(r, me.id)), pageNumber, pageSize, hasMore);
});
