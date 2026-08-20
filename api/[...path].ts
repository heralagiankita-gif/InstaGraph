import type { VercelRequest, VercelResponse } from '@vercel/node';

import authLogin from './_lib/routes/auth-login';
import authMe from './_lib/routes/auth-me';
import authRegister from './_lib/routes/auth-register';
import authSignupResend from './_lib/routes/auth-signup-resend';
import authSignupStart from './_lib/routes/auth-signup-start';
import authSignupVerify from './_lib/routes/auth-signup-verify';
import authUsernameAvailable from './_lib/routes/auth-username-available';
import feedExplore from './_lib/routes/feed-explore';
import feedHome from './_lib/routes/feed-home';
import hashtagsTrending from './_lib/routes/hashtags-trending';
import notificationsUnread from './_lib/routes/notifications-unread-count';
import postsComments from './_lib/routes/posts-comments';
import postsCreate from './_lib/routes/posts-create';
import postsLike from './_lib/routes/posts-like';
import usersFollow from './_lib/routes/users-follow';
import usersSearch from './_lib/routes/users-search';

type Route = (req: VercelRequest, res: VercelResponse) => Promise<void>;

/**
 * Every /api path, served by one function.
 *
 * Vercel's Hobby plan allows twelve serverless functions per deployment and file-based routing spends
 * one per endpoint, so a file per route stops building at the thirteenth — which is a hard ceiling long
 * before this API is finished. Folding them behind a single catch-all costs one dispatch per request
 * and removes the ceiling entirely.
 *
 * It is also faster in the common case. Sixteen functions are sixteen separately warmed instances, each
 * paying its own cold start and holding its own database pool; one function is warmed by any request to
 * any endpoint and pools connections across all of them.
 *
 * The pattern language is deliberately small — a literal segment, or `:name` to capture one. Dynamic
 * segments are written back onto req.query so each handler reads them exactly as it would under
 * file-based routing, and none of them had to change to move here.
 */
const ROUTES: [string, Route][] = [
  ['auth/login', authLogin],
  ['auth/me', authMe],
  ['auth/register', authRegister],
  ['auth/username-available', authUsernameAvailable],
  ['auth/signup/start', authSignupStart],
  ['auth/signup/resend', authSignupResend],
  ['auth/signup/verify', authSignupVerify],

  ['feed', feedHome],
  ['feed/explore', feedExplore],

  ['posts', postsCreate],
  ['posts/:id/like', postsLike],
  ['posts/:id/comments', postsComments],

  ['users/search', usersSearch],
  ['users/:username/follow', usersFollow],

  ['hashtags/trending', hashtagsTrending],
  ['notifications/unread-count', notificationsUnread],
];

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const raw = req.query.path;
  const segments = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);

  for (const [pattern, route] of ROUTES) {
    const params = match(pattern, segments);

    if (params) {
      // Literal routes are listed before the patterns that could also match them — users/search ahead
      // of users/:username/follow — so first match wins is the right rule rather than a lucky one.
      Object.assign(req.query, params);

      return route(req, res);
    }
  }

  res.status(404).json({
    statusCode: 404,
    message: `No API endpoint at /${segments.join('/')}.`,
    path: req.url ?? '',
    timestamp: new Date().toISOString(),
  });
}

/** Returns the captured params when the pattern matches, or null when it does not. */
function match(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split('/');

  if (parts.length !== segments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.startsWith(':')) {
      params[part.slice(1)] = segments[i];
    } else if (part !== segments[i]) {
      return null;
    }
  }

  return params;
}
