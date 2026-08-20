import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { VercelRequest } from '@vercel/node';
import { db, ready } from './db';
import { HttpError, unauthorized } from './http';

const TOKEN_HOURS = 8;

function secret(): string {
  const explicit = process.env.JWT_SECRET;

  if (explicit && explicit.length >= 32) {
    return explicit;
  }

  // Falling back to something derived from the database URL, rather than to a constant.
  //
  // The distinction is the whole point. A hardcoded default would be public knowledge — anyone could
  // mint a token for any account — whereas the connection string is already a secret, is already
  // required for the app to function at all, and is identical across every instance, which is what a
  // signing key has to be or sessions break as requests land on different machines.
  //
  // It exists so that connecting a database is the only setup step. Set JWT_SECRET explicitly and it
  // wins; the trade-off of the fallback is that rotating the database password signs everyone out.
  const database =
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (database) {
    return crypto.createHash('sha256').update(`instagraph:jwt:${database}`).digest('hex');
  }

  throw new HttpError(
    503,
    'No database is connected, so there is nothing to sign sessions with. Connect a Postgres database ' +
      'to this Vercel project, or set JWT_SECRET to 32 or more random characters.',
  );
}

export interface UserRow {
  id: number;
  username: string;
  full_name: string;
  avatar_url: string | null;
  is_private: boolean;
  is_verified: boolean;
}

/** The shape every list row in the client expects. Field names are the client's, so they are camelCase. */
export const summary = (user: UserRow) => ({
  id: user.id,
  username: user.username,
  fullName: user.full_name,
  avatarUrl: user.avatar_url,
  isPrivate: user.is_private,
  isVerified: user.is_verified,
});

export function issue(user: UserRow): { token: string; expiresAt: string } {
  const expires = new Date(Date.now() + TOKEN_HOURS * 3_600_000);

  const token = jwt.sign({ sub: String(user.id), username: user.username }, secret(), {
    expiresIn: `${TOKEN_HOURS}h`,
  });

  return { token, expiresAt: expires.toISOString() };
}

/** Reads the bearer token and returns the account behind it, or refuses. */
export async function requireUser(req: VercelRequest): Promise<UserRow> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    throw unauthorized('Sign in to continue.');
  }

  let id: number;

  try {
    const payload = jwt.verify(token, secret()) as jwt.JwtPayload;
    id = Number(payload.sub);
  } catch {
    throw unauthorized('That session has expired. Sign in again.');
  }

  await ready();

  const { rows } = await db().query<UserRow>(
    `SELECT id, username, full_name, avatar_url, is_private, is_verified
       FROM users WHERE id = $1 AND is_active`,
    [id],
  );

  if (rows.length === 0) {
    throw unauthorized('That account no longer exists.');
  }

  return rows[0];
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/**
 * Six digits, from the crypto source rather than Math.random.
 *
 * This is the only thing standing between a stranger and an account on someone else's address, and
 * Math.random is predictable enough to enumerate given a couple of observed values.
 */
export const sixDigits = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Codes and single-use tokens are stored as digests: a leaked database row should not be usable. */
export const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export const randomToken = () => crypto.randomBytes(32).toString('hex');
