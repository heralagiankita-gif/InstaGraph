import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { VercelRequest } from '@vercel/node';
import { db, ready } from './db';
import { unauthorized } from './http';

const TOKEN_HOURS = 8;

function secret(): string {
  const key = process.env.JWT_SECRET;

  // Deliberately fatal rather than falling back to a default. A signing key with a known value is the
  // same as no authentication at all — anyone could mint a token for any account — and a default would
  // make that failure invisible instead of loud.
  if (!key || key.length < 32) {
    throw new Error(
      'JWT_SECRET is missing or too short. Set it in the Vercel project to at least 32 random characters.',
    );
  }

  return key;
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
