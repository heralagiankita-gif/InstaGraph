import { summary, type UserRow } from './auth';
import { db } from './db';

export interface PostRow extends UserRow {
  post_id: number;
  caption: string;
  location: string | null;
  is_reel: boolean;
  is_archived: boolean;
  like_count: number;
  comment_count: number;
  created_at: Date;
  liked: boolean;
  author_id: number;
  media: { url: string; isVideo: boolean }[] | null;
}

/**
 * The columns every post query needs, written once.
 *
 * Media comes back as JSON from a lateral join rather than as a second round trip per post: a feed page
 * is 8 posts, and 8 extra queries is the difference between one database round trip and nine on a
 * serverless connection where each one crosses a network.
 */
export const POST_COLUMNS = `
  p.id AS post_id, p.caption, p.location, p.is_reel, p.is_archived,
  p.like_count, p.comment_count, p.created_at, p.author_id,
  u.id, u.username, u.full_name, u.avatar_url, u.is_private, u.is_verified,
  (l.user_id IS NOT NULL) AS liked,
  m.media
`;

export const POST_JOINS = `
  FROM posts p
  JOIN users u ON u.id = p.author_id
  LEFT JOIN post_likes l ON l.post_id = p.id AND l.user_id = $1
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('url', pm.url, 'isVideo', pm.is_video) ORDER BY pm.position) AS media
    FROM post_media pm WHERE pm.post_id = p.id
  ) m ON TRUE
`;

/** Shapes a row into the `Post` the client expects. Field names are the client's, so camelCase. */
export function toPost(row: PostRow, viewerId: number) {
  const media = row.media ?? [];

  return {
    id: row.post_id,
    author: summary({
      id: row.id,
      username: row.username,
      full_name: row.full_name,
      avatar_url: row.avatar_url,
      is_private: row.is_private,
      is_verified: row.is_verified,
    }),
    imageUrl: media[0]?.url ?? '',
    media,
    caption: row.caption,
    location: row.location,
    isReel: row.is_reel,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    viewCount: 0,
    isLiked: row.liked,
    isSaved: false,
    isMine: row.author_id === viewerId,
    commentsDisabled: false,
    hideCounts: false,
    isPinned: false,
    isArchived: row.is_archived,
    tags: [],

    // Null rather than false on purpose: a directed edge has four states, and a follow button that
    // reads false as "not following" will tell somebody to follow an account they already follow.
    isFollowingAuthor: null,
    createdAt: row.created_at.toISOString(),
  };
}

export const page = <T>(items: T[], pageNumber: number, pageSize: number, hasMore: boolean) => ({
  items,
  pageNumber,
  pageSize,
  hasMore,
});

/** Reads `page`/`pageSize` from a query string, clamped so a hand-written URL cannot ask for everything. */
export function paging(query: Record<string, unknown>, fallback: number, max: number) {
  const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);

  const pageNumber = Math.max(1, Number(one(query.page)) || 1);
  const pageSize = Math.min(max, Math.max(1, Number(one(query.pageSize)) || fallback));

  return { pageNumber, pageSize, offset: (pageNumber - 1) * pageSize };
}

/** Pulls #tags out of a caption and links them, creating any that are new. */
export async function linkHashtags(postId: number, caption: string): Promise<void> {
  const tags = [...new Set((caption.match(/#[\p{L}0-9_]{1,50}/gu) ?? []).map((t) => t.slice(1).toLowerCase()))];

  if (tags.length === 0) {
    return;
  }

  const pool = db();

  // ON CONFLICT DO UPDATE rather than DO NOTHING: DO NOTHING returns no row for tags that already
  // existed, so RETURNING would silently drop exactly the tags that are most used.
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO hashtags (tag) SELECT UNNEST($1::text[])
     ON CONFLICT (tag) DO UPDATE SET tag = EXCLUDED.tag
     RETURNING id`,
    [tags],
  );

  await pool.query(
    `INSERT INTO post_hashtags (post_id, hashtag_id)
     SELECT $1, UNNEST($2::int[]) ON CONFLICT DO NOTHING`,
    [postId, rows.map((r) => r.id)],
  );
}
