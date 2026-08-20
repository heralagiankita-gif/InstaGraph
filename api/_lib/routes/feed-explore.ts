import { requireUser } from '../auth';
import { db, ready } from '../db';
import { handler, methods } from '../http';
import { POST_COLUMNS, POST_JOINS, page, paging, toPost, type PostRow } from '../posts';

/**
 * Explore: posts from accounts you do not follow.
 *
 * Ranked on what a post has drawn rather than on who made it, with a lift for anyone two hops away —
 * near strangers before actual strangers, which is the cheap half of what the .NET graph service does
 * with Adamic-Adar. Private accounts never appear here; their posts are for their followers.
 */
export default handler(async (req) => {
  methods(req, 'GET');

  const me = await requireUser(req);
  const { pageNumber, pageSize, offset } = paging(req.query, 24, 48);

  await ready();

  const { rows } = await db().query<PostRow>(
    `SELECT ${POST_COLUMNS},
            (LN(1 + p.like_count + p.comment_count * 2))
            + (CASE WHEN p.author_id IN (
                 SELECT f2.followee_id FROM follows f1
                 JOIN follows f2 ON f2.follower_id = f1.followee_id
                 WHERE f1.follower_id = $1 AND NOT f1.is_pending AND NOT f2.is_pending
               ) THEN 2.5 ELSE 0 END)
            - (EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400.0) * 0.1 AS score
       ${POST_JOINS}
      WHERE NOT p.is_archived
        AND NOT u.is_private
        AND u.is_active
        AND p.author_id <> $1
        AND p.author_id NOT IN (
              SELECT followee_id FROM follows WHERE follower_id = $1)
      ORDER BY score DESC, p.created_at DESC
      LIMIT $2 OFFSET $3`,
    [me.id, pageSize + 1, offset],
  );

  const hasMore = rows.length > pageSize;

  return page(rows.slice(0, pageSize).map((r) => toPost(r, me.id)), pageNumber, pageSize, hasMore);
});
