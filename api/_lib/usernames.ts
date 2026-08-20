import { db } from './db';

/**
 * Names the app needs for its own routes, plus the handful nobody should be able to impersonate.
 * Checked before the database, because /explore is not "taken" — it is not a username at all.
 */
const RESERVED = new Set([
  'explore', 'reels', 'messages', 'settings', 'activity', 'create', 'discover', 'network',
  'archive', 'login', 'register', 'signup', 'logout', 'p', 'tags', 'api', 'admin',
  'instagraph', 'support', 'help', 'about', 'privacy', 'terms', 'null', 'undefined',
]);

const SHAPE = /^[a-z0-9._]{3,30}$/;

export interface Availability {
  username: string;
  available: boolean;
  reason: string | null;
  suggestions: string[];
}

export async function checkUsername(raw: string): Promise<Availability> {
  const username = raw.trim().toLowerCase();

  if (!SHAPE.test(username)) {
    return {
      username,
      available: false,
      reason: 'Usernames are 3–30 characters, using lower-case letters, numbers, dots and underscores.',
      suggestions: [],
    };
  }

  if (RESERVED.has(username)) {
    return {
      username,
      available: false,
      reason: 'That name is reserved.',
      suggestions: await freeVariations(username),
    };
  }

  const taken = await db().query(`SELECT 1 FROM users WHERE LOWER(username) = $1`, [username]);

  if (taken.rowCount) {
    return {
      username,
      available: false,
      reason: 'That username is taken.',
      suggestions: await freeVariations(username),
    };
  }

  return { username, available: true, reason: null, suggestions: [] };
}

/**
 * Variations on a taken name, filtered against the database in one query rather than one per
 * candidate — the check runs while somebody is still typing, so it is on the critical path.
 */
async function freeVariations(username: string): Promise<string[]> {
  const stem = username.slice(0, 26);

  const candidates = [
    `${stem}_`,
    `${stem}.1`,
    `${stem}${new Date().getFullYear() % 100}`,
    `the.${stem}`.slice(0, 30),
    `${stem}_official`.slice(0, 30),
    `${stem}${Math.floor(Math.random() * 90 + 10)}`,
  ].filter((name) => SHAPE.test(name) && !RESERVED.has(name));

  if (candidates.length === 0) {
    return [];
  }

  const { rows } = await db().query<{ username: string }>(
    `SELECT LOWER(username) AS username FROM users WHERE LOWER(username) = ANY($1)`,
    [candidates],
  );

  const used = new Set(rows.map((row) => row.username));

  return candidates.filter((name) => !used.has(name)).slice(0, 3);
}

export { RESERVED, SHAPE };
